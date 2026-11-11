import { Check } from "lucide-react";
import type { TopicStat } from "../lib/types";
import { ResultTable, type ResultColumn } from "./ResultTable";
import "./planning.css";

const percent = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const decimal = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

function HoursExplanation({ topic }: { topic: TopicStat }) {
  const { minimumHours, weight, extraQuota, extraWholeHours, remainderHour } = topic.allocation;
  const change = topic.delta === 0
    ? `План сохраняет текущие ${topic.currentHours} ч.`
    : `Переход с ${topic.currentHours} до ${topic.recommendedHours} ч. (${topic.delta > 0 ? "+" : "−"}${Math.abs(topic.delta)} ч.).`;
  return (
    <details className="plan-explanation">
      <summary aria-label={`Как рассчитано для темы «${topic.topic}»`}>Как рассчитано</summary>
      <div className="plan-explanation-body">
        <p>{change}</p>
        <p>
          При результате {percent.format(topic.mean)}% и текущих {topic.currentHours} ч. вес темы — {decimal.format(weight)}.
          При тех же текущих часах более низкий результат даёт больший вес.
        </p>
        <dl>
          <div><dt>Минимум</dt><dd>{minimumHours} ч.</dd></div>
          <div><dt>Из остатка бюджета</dt><dd>{extraWholeHours} ч.</dd></div>
          <div><dt>За дробный остаток</dt><dd>{remainderHour} ч.</dd></div>
        </dl>
        <p>Доля свободных часов по весу — около {decimal.format(extraQuota)} ч. Сначала засчитывается целая часть. После этого свободные часы получают темы с наибольшей дробной частью.</p>
        <p className="plan-explanation-total">{minimumHours} + {extraWholeHours} + {remainderHour} = {topic.recommendedHours} ч.</p>
      </div>
    </details>
  );
}

const columns: ResultColumn<TopicStat>[] = [
  {
    id: "topic", label: "Тема программы", value: (topic) => topic.topic, text: true,
    render: (topic) => (
      <>
        <strong>{topic.topic}</strong>
        <small className="table-sub">{topic.count} результатов</small>
        {topic.allocation.minimumHours > 1 && <small className="table-sub plan-required-hours">Минимум {topic.allocation.minimumHours} ч.</small>}
        <HoursExplanation topic={topic} />
      </>
    ),
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
