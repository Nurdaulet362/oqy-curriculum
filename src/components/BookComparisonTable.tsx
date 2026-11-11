import { useMemo } from "react";
import type { BookStat, TopicStat } from "../lib/types";
import { ResultTable, type ResultColumn } from "./ResultTable";

const percent = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
type Comparison = Map<string, Map<string, { sum: number; count: number }>>;

export function BookComparisonTable({ topics, books, comparison }: { topics: TopicStat[]; books: BookStat[]; comparison: Comparison }) {
  const columns = useMemo<ResultColumn<TopicStat>[]>(() => [
    { id: "topic", label: "Тема", text: true, value: (topic) => topic.topic, render: (topic) => topic.topic },
    ...books.map((book, index): ResultColumn<TopicStat> => ({
      // User labels can contain dots or arbitrary text; IDs never derive from them.
      id: `book-${index}`,
      label: book.textbook,
      value: (topic) => {
        const cell = comparison.get(topic.topic)?.get(book.textbook);
        return cell ? cell.sum / cell.count : undefined;
      },
      render: (topic) => {
        const cell = comparison.get(topic.topic)?.get(book.textbook);
        return cell ? <><strong>{percent.format(cell.sum / cell.count)}%</strong> <small>({cell.count})</small></> : "Нет данных";
      },
    })),
  ], [books, comparison]);
  return <ResultTable
    data={topics}
    columns={columns}
    label="Сравнение учебников по темам"
    scopeNote="Поиск меняет только строки таблицы. Показатели учебников и отчёт рассчитаны по всему выбранному набору. При сортировке строки без данных остаются в конце."
  />;
}
