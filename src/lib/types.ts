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
export interface TopicStat {
  topic: string;
  mean: number;
  count: number;
  students: number;
  mastery: number;
  currentHours: number;
  recommendedHours: number;
  delta: number;
  priority: "high" | "medium" | "low";
}
export interface BookStat {
  textbook: string;
  mean: number;
  adjustedMean: number | null;
  count: number;
  students: number;
  topicCount: number;
  comparable: boolean;
}
export interface Analysis {
  mean: number;
  mastery: number;
  students: number;
  schools: number;
  topics: TopicStat[];
  books: BookStat[];
  totalHours: number;
  recommendedTotal: number;
  commonTopics: string[];
  warnings: string[];
}
export interface ParseResult {
  rows: ResultRow[];
  errors: string[];
}
