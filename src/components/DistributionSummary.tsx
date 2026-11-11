import type { Distribution } from "../lib/types";
import "./statistics.css";

const format = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const value = (n: number | null) => n === null ? "—" : format.format(n);

export function DistributionFacts({ distribution: d, compact = false }: { distribution: Distribution; compact?: boolean }) {
  return (
    <dl className={`distribution-facts ${compact ? "compact" : ""}`}>
      <div><dt>Медиана</dt><dd>{value(d.median)}%</dd></div>
      <div><dt>Квартили Q1–Q3</dt><dd>{value(d.q1)}–{value(d.q3)}%</dd></div>
      {!compact && <>
        <div><dt>Минимум — максимум</dt><dd>{value(d.min)}–{value(d.max)}%</dd></div>
        <div><dt>Стандартное отклонение</dt><dd>{value(d.stdDev)} <span>п.п.</span></dd></div>
      </>}
    </dl>
  );
}

export function DistributionSummary({ distribution }: { distribution: Distribution }) {
  return (
    <section className="panel distribution-panel" aria-labelledby="distribution-title">
      <div className="panel-heading">
        <div>
          <h2 id="distribution-title">Как распределены результаты</h2>
          <p>{distribution.count} наблюдений по выбранным фильтрам. Один ученик может иметь результаты по нескольким темам.</p>
        </div>
      </div>
      <DistributionFacts distribution={distribution} />
      <ul className="score-bins" aria-label="Распределение результатов по диапазонам баллов">
        {distribution.bins.map((bin) => (
          <li key={bin.label}>
            <span>{bin.label}</span>
            <span className="histogram-track" aria-hidden="true"><span style={{ width: `${distribution.count ? bin.count / distribution.count * 100 : 0}%` }} /></span>
            <strong>{bin.count} <small>({value(distribution.count ? bin.count / distribution.count * 100 : 0)}%)</small></strong>
          </li>
        ))}
      </ul>
      <details className="statistics-help">
        <summary>Как читать эти показатели</summary>
        <p>Медиана — середина упорядоченных результатов. Q1 и Q3 — границы центральной части распределения (25-й и 75-й процентили). Стандартное отклонение показывает разброс в процентных пунктах, с делением на число наблюдений.</p>
        <p>Каждый балл сначала делится на максимум задания. Квартили рассчитаны линейной интерполяцией (Type 7). Это описание загруженных результатов, без оценки причин различий или прогноза успеваемости.</p>
      </details>
    </section>
  );
}
