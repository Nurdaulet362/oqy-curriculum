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
