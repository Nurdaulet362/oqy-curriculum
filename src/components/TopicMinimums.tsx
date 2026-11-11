import { useId, useRef, useState, type FormEvent } from "react";
import type { TopicStat } from "../lib/types";
import "./planning.css";

interface TopicMinimumsProps {
  topics: TopicStat[];
  minimumTotal: number;
  budget: number;
  disabled: boolean;
  onApply: (topic: string, value: string) => string | null;
}

export function TopicMinimums({ topics, minimumTotal, budget, disabled, onApply }: TopicMinimumsProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [selectedTopic, setSelectedTopic] = useState(topics[0]?.topic ?? "");
  const [draft, setDraft] = useState(String(topics[0]?.allocation.minimumHours ?? 1));
  const [error, setError] = useState("");
  const minimumHours = topics.find((topic) => topic.topic === selectedTopic)?.allocation.minimumHours ?? 1;

  function selectTopic(name: string) {
    const topic = topics.find((item) => item.topic === name);
    setSelectedTopic(name);
    setDraft(String(topic?.allocation.minimumHours ?? 1));
    setError("");
  }

  function apply(value: string) {
    const problem = onApply(selectedTopic, value);
    setError(problem ?? "");
    if (!problem) setDraft(String(Number(value)));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    apply(draft);
  }

  return (
    <section className="panel topic-minimums" aria-labelledby={`${id}-heading`}>
      <div className="panel-heading">
        <div>
          <h2 id={`${id}-heading`}>Обязательные темы</h2>
          <p>У каждой темы минимум 1 час. Выберите тему, которой нужно зарезервировать больше времени.</p>
        </div>
      </div>
      <form className="topic-minimum-form" noValidate onSubmit={submit}>
        <div className="topic-minimum-controls">
          <label>
            Тема для минимума
            <select name="minimum-topic" value={selectedTopic} disabled={disabled} onChange={(event) => selectTopic(event.target.value)}>
              {topics.map((topic) => <option key={topic.topic} value={topic.topic}>{topic.topic}</option>)}
            </select>
          </label>
          <label>
            Минимум часов
            <input
              ref={input}
              name="topic-minimum-hours"
              type="number"
              inputMode="numeric"
              autoComplete="off"
              min={1}
              max={budget - minimumTotal + minimumHours}
              step={1}
              value={draft}
              disabled={disabled}
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-applied ${id}-error` : `${id}-applied`}
              onChange={(event) => {
                setDraft(event.target.value);
                setError("");
              }}
            />
          </label>
          <button type="submit" className="btn primary" disabled={disabled}>Применить минимум</button>
        </div>
        <div className="topic-minimum-applied">
          <p id={`${id}-applied`} aria-live="polite">Для выбранной темы зарезервировано <strong>{minimumHours} ч.</strong></p>
          {minimumHours > 1 && (
            <button type="button" className="text-button" disabled={disabled} onClick={() => {
              apply("1");
              input.current?.focus();
            }}>Вернуть 1 час</button>
          )}
        </div>
        {error && <p id={`${id}-error`} className="notice error topic-minimum-error" role="alert">{error}</p>}
      </form>
      <p className="topic-minimum-total" aria-live="polite">
        Сумма минимумов — <strong>{minimumTotal} ч.</strong> из {budget} ч. бюджета.
        К распределению — <strong>{budget - minimumTotal} ч.</strong>
      </p>
    </section>
  );
}
