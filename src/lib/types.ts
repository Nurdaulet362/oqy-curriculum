export interface ResultRow {
  student_id: string;
  school: string;
  grade: string;
  subject: string;
  topic: string;
  textbook: string;
  score: number;
  max_score: number;
  hours: number;
}
/** Descriptive statistics over normalized result rows, not unique students.
 * Quartiles use linear interpolation (Type 7); stdDev uses divisor n and is in
 * percentage points. An empty group has null measures and zero bin counts. */
export interface Distribution {
  count: number;
  median: number | null;
  q1: number | null;
  q3: number | null;
  min: number | null;
  max: number | null;
  stdDev: number | null;
  bins: Array<{ label: string; count: number }>;
}
export interface TopicStat {
  topic: string;
  mean: number;
  distribution: Distribution;
  count: number;
  students: number;
  mastery: number;
  currentHours: number;
  recommendedHours: number;
  delta: number;
  allocation: {
    minimumHours: number;
    weight: number;
    extraQuota: number;
    extraWholeHours: number;
    remainderHour: 0 | 1;
  };
  priority: "high" | "medium" | "low";
}
export interface BookStat {
  textbook: string;
  mean: number;
  /** All result rows for this book; unlike adjustedMean, not common-topic weighted. */
  distribution: Distribution;
  adjustedMean: number | null;
  count: number;
  students: number;
  topicCount: number;
  comparable: boolean;
}
export interface Analysis {
  mean: number;
  distribution: Distribution;
  mastery: number;
  students: number;
  schools: number;
  topics: TopicStat[];
  books: BookStat[];
  totalHours: number;
  minimumTotal: number;
  recommendedTotal: number;
  commonTopics: string[];
  warnings: string[];
}
export interface ParseResult {
  rows: ResultRow[];
  errors: string[];
}
