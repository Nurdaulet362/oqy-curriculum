import { Check } from "lucide-react";
import type { TopicStat } from "../lib/types";
import { ResultTable, type ResultColumn } from "./ResultTable";

const percent = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const columns: ResultColumn<TopicStat>[] = [
  {
    id: "topic", label: "Тема программы", value: (topic) => topic.topic, text: true,
    render: (topic) => <><strong>{topic.topic}</strong><small className="table-sub">{topic.count} результатов</small></>,
  },
  {
    id: "mean", label: "Результат", value: (topic) => topic.mean,
    render: (topic) => <span className={`score-pill ${topic.mean < 70 ? "warm" : ""}`}>{percent.format(topic.mean)}%</span>,
  },
  { id: "currentHours", label: "Сейчас, ч.", value: (topic) => topic.currentHours, render: (topic) => topic.currentHours },
  { id: "recommendedHours", label: "План, ч.", value: (topic) => topic.recommendedHours, render: (topic) => <strong>{topic.recommendedHours}</strong> },
  {
    id: "delta", label: "Изменение", value: (topic) => topic.delta,
    render: (topic) => <span className={`delta ${topic.delta > 0 ? "positive" : topic.delta < 0 ? "negative" : ""}`}>{topic.delta === 0 ? "Без изменений" : `${topic.delta > 0 ? "+" : ""}${topic.delta} ч.`}</span>,
  },
];
const initialSorting = [{ id: "mean", desc: false }];

export function PlanTable({ topics, totalHours, recommendedTotal }: { topics: TopicStat[]; totalHours: number; recommendedTotal: number }) {
  return <ResultTable
    data={topics}
    columns={columns}
    label="Предлагаемый учебный план"
    initialSorting={initialSorting}
    scopeNote="Поиск и сортировка меняют только отображение. Итог и скачиваемый план включают все темы выбранного набора."
    footer={<tr><td>Всего часов</td><td /><td>{totalHours}</td><td>{recommendedTotal}</td><td><span className="conserved"><Check size={15} aria-hidden="true" />Бюджет соблюдён</span></td></tr>}
  />;
}
