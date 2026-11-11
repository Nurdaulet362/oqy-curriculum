import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseCSV } from "./csv";
import { analyze } from "./analytics";
import type { ResultRow } from "./types";
const row = (
  id: string,
  topic: string,
  score: number,
  textbook = "A",
  hours = 4,
  max_score = 10,
): ResultRow => ({
  student_id: id,
  school: "S",
  grade: "7",
  subject: "Математика",
  topic,
  textbook,
  score,
  max_score,
  hours,
});

describe("transparent cohort analytics", () => {
  it("normalizes different maximum scores per attempt and counts unique students", () => {
    const result = analyze([
      row("1", "Fractions", 7),
      row("1", "Geometry", 10, "A", 4, 20),
      row("2", "Fractions", 9),
    ]);
    expect(result.mean).toBeCloseTo(70);
    expect(result.mastery).toBeCloseTo(200 / 3);
    expect(result.students).toBe(2);
    expect(result.totalHours).toBe(8);
    expect(result.topics.find((t) => t.topic === "Fractions")?.mean).toBe(80);
  });
  it("preserves every tested hour budget with positive integer allocations", () => {
    const rows = [
      row("1", "Hard", 1),
      row("1", "Middle", 5),
      row("1", "Easy", 10),
    ];
    for (let budget = 3; budget <= 100; budget++) {
      const result = analyze(rows, budget);
      expect(result.recommendedTotal).toBe(budget);
      expect(
        result.topics.every(
          (t) =>
            Number.isInteger(t.recommendedHours) && t.recommendedHours >= 1,
        ),
      ).toBe(true);
      expect(result.topics.reduce((sum, t) => sum + t.delta, 0)).toBe(
        budget - 12,
      );
    }
    const result = analyze(rows, 12);
    expect(result.topics[0].recommendedHours).toBeGreaterThan(
      result.topics[2].recommendedHours,
    );
  });
  it("produces a nontrivial demo proposal while preserving its 34-hour budget", () => {
    const parsed = parseCSV(
      readFileSync(
        new URL("../../public/data/demo.csv", import.meta.url),
        "utf8",
      ),
    );
    expect(parsed.errors).toEqual([]);
    const result = analyze(parsed.rows);
    expect(result.totalHours).toBe(34);
    expect(result.recommendedTotal).toBe(result.totalHours);
    expect(result.topics.some((topic) => topic.delta > 0)).toBe(true);
    expect(result.topics.some((topic) => topic.delta < 0)).toBe(true);
    expect(result.topics.reduce((sum, topic) => sum + topic.delta, 0)).toBe(0);
  });
  it("rejects impossible or noninteger budgets", () => {
    const rows = [row("1", "A", 5), row("1", "B", 5)];
    for (const budget of [0, 1, 2.5, NaN, Infinity, 100001])
      expect(() => analyze(rows, budget)).toThrow(RangeError);
  });
  it("uses equal topic weights for common-topic textbook comparison", () => {
    const rows = [
      row("1", "X", 10, "A"),
      row("2", "X", 10, "A"),
      row("1", "Y", 2, "A"),
      row("3", "X", 6, "B"),
      row("3", "Y", 8, "B"),
      row("1", "Extra", 0, "A"),
    ];
    const result = analyze(rows);
    const a = result.books.find((b) => b.textbook === "A")!;
    const b = result.books.find((b) => b.textbook === "B")!;
    expect(a.mean).toBe(55);
    expect(a.adjustedMean).toBe(60);
    expect(b.adjustedMean).toBe(70);
    expect(result.commonTopics.sort()).toEqual(["X", "Y"]);
    expect(a.comparable).toBe(true);
    expect(result.warnings.some((w) => w.includes("наблюдательное"))).toBe(
      true,
    );
  });
  it("does not invent a comparable score when topic coverage differs completely", () => {
    const result = analyze([row("1", "X", 9, "A"), row("2", "Y", 5, "B")]);
    expect(result.commonTopics).toEqual([]);
    expect(
      result.books.every((b) => b.adjustedMean === null && !b.comparable),
    ).toBe(true);
  });
  it("returns safe empty values and flags small samples", () => {
    expect(analyze([]).mean).toBe(0);
    expect(analyze([]).topics).toEqual([]);
    expect(
      analyze([row("1", "X", 5)]).warnings.some((w) =>
        w.includes("Малая выборка"),
      ),
    ).toBe(true);
  });
  it("rejects inconsistent plans and nonfinite scores", () => {
    expect(() =>
      analyze([row("1", "X", 5), row("2", "X", 5, "A", 6)]),
    ).toThrow();
    expect(() => analyze([row("1", "X", NaN)])).toThrow();
  });
});

describe("percentage boundary stability", () => {
  it("recognizes an exact decimal 70% without classifying it below mastery", () => {
    const result = analyze([row("1", "Decimal", 5.81, "A", 4, 8.3)]);
    expect(result.mean).toBe(70);
    expect(result.mastery).toBe(100);
    expect(result.topics[0].priority).toBe("low");
    expect(result.topics[0].mastery).toBe(100);
  });
  it("retains a materially lower score below the threshold", () => {
    const result = analyze([row("1", "Below", 69.9999999, "A", 4, 100)]);
    expect(result.mastery).toBe(0);
    expect(result.topics[0].priority).toBe("medium");
  });
});

describe("descriptive result distributions", () => {
  const results = (scores: number[]) =>
    scores.map((score, index) => row(String(index), "Topic", score, "A", 4, 100));

  it("uses Type 7 interpolation for even and odd groups and exposes skew", () => {
    const skewed = analyze(results([0, 10, 20, 100]));
    expect(skewed.mean).toBe(32.5);
    expect(skewed.distribution).toMatchObject({
      count: 4, median: 15, q1: 7.5, q3: 40, min: 0, max: 100,
    });
    expect(analyze(results([10, 20, 30, 40, 100])).distribution).toMatchObject({
      count: 5, median: 30, q1: 20, q3: 40,
    });
  });

  it("reports descriptive standard deviation with divisor n, in percentage points", () => {
    const data = [20, 40, 40, 40, 50, 50, 70, 90];
    const result = analyze(results(data));
    expect(result.mean).toBe(50);
    // Squared deviations sum to 3200, so sqrt(3200 / 8) = 20.
    expect(result.distribution.stdDev).toBe(20);
    expect(result.distribution.median).toBe(45);
    expect(result.distribution.q1).toBe(40);
    expect(result.distribution.q3).toBe(55);
  });

  it("normalizes each maximum before calculating group statistics", () => {
    const result = analyze([
      row("1", "Topic", 1, "A", 4, 2),
      row("2", "Topic", 1, "A", 4, 4),
      row("3", "Topic", 9, "A", 4, 10),
    ]);
    expect(result.distribution).toMatchObject({
      count: 3, min: 25, q1: 37.5, median: 50, q3: 70, max: 90,
    });
    expect(result.topics[0].distribution).toEqual(result.distribution);
    expect(result.books[0].distribution).toEqual(result.distribution);
  });

  it("does not invent statistics for an empty cohort and handles a singleton", () => {
    const empty = analyze([]).distribution;
    expect(empty).toMatchObject({
      count: 0, min: null, max: null, median: null, q1: null, q3: null, stdDev: null,
    });
    expect(empty.bins.map((bin) => bin.count)).toEqual([0, 0, 0, 0, 0]);
    const single = analyze([row("1", "Decimal", 5.81, "A", 4, 8.3)]).distribution;
    expect(single).toMatchObject({
      count: 1, min: 70, max: 70, median: 70, q1: 70, q3: 70, stdDev: 0,
    });
    expect(single.bins.map((bin) => bin.count)).toEqual([0, 0, 0, 1, 0]);
  });

  it("assigns every result to exactly one half-open bin and includes 100%", () => {
    const result = analyze(results([
      0, 19.9999999, 20, 39.9999999, 40, 59.9999999, 60, 79.9999999, 80, 100,
    ]));
    expect(result.distribution.bins).toEqual([
      { label: "0–<20%", count: 2 },
      { label: "20–<40%", count: 2 },
      { label: "40–<60%", count: 2 },
      { label: "60–<80%", count: 2 },
      { label: "80–100%", count: 2 },
    ]);
  });

  it("counts observed topic results rather than treating them as independent students", () => {
    const result = analyze([
      row("1", "X", 2), row("1", "Y", 8), row("2", "X", 4),
    ]);
    expect(result.students).toBe(2);
    expect(result.distribution.count).toBe(3);
    expect(result.distribution.median).toBe(40);
    expect(result.topics.find((topic) => topic.topic === "X")?.distribution)
      .toMatchObject({ count: 2, median: 30 });
    expect(result.topics.find((topic) => topic.topic === "Y")?.distribution)
      .toMatchObject({ count: 1, median: 80 });
  });

  it("keeps textbook distributions over all rows distinct from adjusted comparison", () => {
    const result = analyze([
      row("1", "X", 10, "A"), row("2", "X", 10, "A"),
      row("1", "Y", 2, "A"), row("1", "Extra", 0, "A"),
      row("3", "X", 6, "B"), row("3", "Y", 8, "B"),
    ]);
    const a = result.books.find((book) => book.textbook === "A")!;
    expect(a.mean).toBe(55);
    expect(a.adjustedMean).toBe(60);
    expect(a.distribution).toMatchObject({ count: 4, min: 0, q1: 15, median: 60, max: 100 });
    expect(a.distribution.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(a.count);
    expect(result.books.find((book) => book.textbook === "B")?.distribution)
      .toMatchObject({ count: 2, min: 60, q1: 65, median: 70, q3: 75, max: 80 });
  });

  it("does not mutate imported rows and keeps distribution independent of hour budget", () => {
    const data = results([100, 0, 50]);
    const snapshot = JSON.stringify(data);
    const original = analyze(data);
    const proposed = analyze(data, 40);
    expect(JSON.stringify(data)).toBe(snapshot);
    expect(proposed.distribution).toEqual(original.distribution);
    expect(proposed.topics[0].distribution).toEqual(original.topics[0].distribution);
    expect(proposed.recommendedTotal).toBe(40);
  });
});
