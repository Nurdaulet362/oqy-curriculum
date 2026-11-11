import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Database,
  FileSpreadsheet,
  GraduationCap,
  LayoutDashboard,
  Leaf,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Users,
  X,
} from "lucide-react";
import { analyze } from "./lib/analytics";
import { parseCSV } from "./lib/csv";
import type { Analysis, ResultRow } from "./lib/types";

type View = "overview" | "books" | "plan" | "data" | "method";
const nav = [
  { id: "overview", label: "Обзор программы", icon: LayoutDashboard },
  { id: "books", label: "Сравнение учебников", icon: BookOpen },
  { id: "plan", label: "Планирование часов", icon: Clock3 },
  { id: "data", label: "Источники данных", icon: Database },
] as const;
const pct = (n: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(n);
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Report({
  analysis,
  source,
  subject,
  grade,
  school,
}: {
  analysis: Analysis;
  source: string;
  subject: string;
  grade: string;
  school: string;
}) {
  const exportReport = () =>
    download(
      "oqy-report.json",
      JSON.stringify(
        {
          project: "OQY",
          created_at: new Date().toISOString(),
          source,
          filters: { subject, grade, school },
          limitations:
            "Описательная аналитика. Сравнение не доказывает причинную эффективность учебника. План — предложение для методиста.",
          analysis,
        },
        null,
        2,
      ),
      "application/json",
    );
  return (
    <button className="btn secondary" onClick={exportReport}>
      <ArrowDownToLine size={16} />
      Скачать отчёт
    </button>
  );
}
export default function App() {
  const [view, setView] = useState<View>("overview");
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [source, setSource] = useState("Демонстрационный набор");
  const [isDemo, setIsDemo] = useState(true);
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const [school, setSchool] = useState("all");
  const [budget, setBudget] = useState<number | undefined>();
  const [budgetDraft, setBudgetDraft] = useState("");
  const [budgetError, setBudgetError] = useState("");
  const [error, setError] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  function install(next: ResultRow[], name: string, demo: boolean) {
    setRows(next);
    setSource(name);
    setIsDemo(demo);
    setSubject(next[0]?.subject ?? "");
    setGrade(next[0]?.grade ?? "");
    setSchool("all");
    setBudget(undefined);
    setError([]);
    setSelectedTopic(null);
  }
  async function loadDemo() {
    setBusy(true);
    try {
      const res = await fetch("/data/demo.csv");
      if (!res.ok)
        throw new Error("Не удалось загрузить демо. Попробуйте ещё раз.");
      const parsed = parseCSV(await res.text());
      if (parsed.errors.length) throw new Error(parsed.errors.join(" "));
      install(parsed.rows, "Демонстрационный набор", true);
    } catch (e) {
      setError([e instanceof Error ? e.message : "Ошибка загрузки"]);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void loadDemo();
  }, []);
  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error(
          "Файл больше 5 МБ. Разделите данные на несколько наборов.",
        );
      const parsed = parseCSV(await file.text());
      if (parsed.errors.length) {
        setError(parsed.errors);
        return;
      }
      install(parsed.rows, file.name, false);
      setMessage(
        `Загружено ${parsed.rows.length} результатов. Данные обработаны локально.`,
      );
      setView("overview");
    } catch (e) {
      setError([e instanceof Error ? e.message : "Не удалось прочитать файл"]);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  const subjects = [...new Set(rows.map((r) => r.subject))];
  const grades = [
    ...new Set(rows.filter((r) => r.subject === subject).map((r) => r.grade)),
  ];
  const schools = [
    ...new Set(
      rows
        .filter((r) => r.subject === subject && r.grade === grade)
        .map((r) => r.school),
    ),
  ];
  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.subject === subject &&
          r.grade === grade &&
          (school === "all" || r.school === school),
      ),
    [rows, subject, grade, school],
  );
  const result = useMemo(() => {
    try {
      return { analysis: analyze(filtered, budget), error: "" };
    } catch (e) {
      return {
        analysis: null,
        error: e instanceof Error ? e.message : "Не удалось рассчитать план",
      };
    }
  }, [filtered, budget]);
  const a = result.analysis;
  useEffect(() => {
    setBudgetDraft(String(budget ?? a?.totalHours ?? ""));
    setBudgetError("");
  }, [budget, a?.totalHours]);
  function applyBudget() {
    const n = Number(budgetDraft);
    if (!Number.isInteger(n) || n < (a?.topics.length ?? 1) || n > 100000) {
      setBudgetError(
        `Введите целое число от ${a?.topics.length ?? 1} до 100000.`,
      );
      return;
    }
    setBudget(n);
    setBudgetError("");
  }
  const weak = a?.topics.filter((t) => t.mean < 70) ?? [];
  const sorted = [...(a?.topics ?? [])].sort((x, y) => x.mean - y.mean);
  const activeTopic = a?.topics.find((t) => t.topic === selectedTopic);
  const title =
    view === "overview"
      ? "Каждая тема. Полная картина."
      : view === "books"
        ? "Учебники в сравнении"
        : view === "plan"
          ? "Часы там, где они нужны"
          : view === "data"
            ? "Данные, которым можно доверять"
            : "Как устроены расчёты";
  function changeSubject(value: string) {
    setSubject(value);
    setGrade(rows.find((r) => r.subject === value)?.grade ?? "");
    setSchool("all");
    setBudget(undefined);
  }
  function exportPlan() {
    if (!a) return;
    const escape = (s: string) =>
      '"' + (/^[=+@\-\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""') + '"';
    download(
      "oqy-plan.csv",
      "\uFEFFtopic,mean_percent,current_hours,recommended_hours,delta\n" +
        a.topics
          .map((t) =>
            [
              escape(t.topic),
              t.mean.toFixed(2),
              t.currentHours,
              t.recommendedHours,
              t.delta,
            ].join(","),
          )
          .join("\n"),
      "text/csv;charset=utf-8",
    );
    setMessage("План часов сохранён в CSV.");
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("overview");
          }}
        >
          <span className="brand-mark">
            <BookOpen size={23} />
          </span>
          oqy<span className="brand-dot">.</span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">
            <GraduationCap size={19} />
          </span>
          <span>
            Кабинет методиста<small>Учебная аналитика</small>
          </span>
          <ChevronDown size={14} />
        </div>
        <p className="nav-label">РАБОЧЕЕ ПРОСТРАНСТВО</p>
        <nav aria-label="Основная навигация">
          {nav.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${view === n.id ? "active" : ""}`}
              onClick={() => {
                setView(n.id);
                setSelectedTopic(null);
              }}
            >
              <n.icon size={18} />
              {n.label}
              {view === n.id && <span className="nav-dot" />}
            </button>
          ))}
          <button
            className="nav-item mobile-only"
            onClick={() => setView("method")}
          >
            <CircleHelp size={18} />
            Методология
          </button>
          <a
            className="nav-item mobile-only"
            href="/pitch.html"
            target="_blank"
            rel="noreferrer"
          >
            <ArrowUpRight size={18} />
            Презентация
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy">
            <ShieldCheck size={21} />
            <strong>Ваши данные — у вас</strong>
            <p>
              Обработка в браузере.
              <br />
              Без загрузки на сервер.
            </p>
          </div>
          <button
            className={`nav-item ${view === "method" ? "active" : ""}`}
            onClick={() => setView("method")}
          >
            <CircleHelp size={18} />
            Методология
          </button>
          <a
            className="nav-item"
            href="/pitch.html"
            target="_blank"
            rel="noreferrer"
          >
            <ArrowUpRight size={18} />
            Презентация проекта
          </a>
          <div className="profile">
            <span>М</span>
            <div>
              Методист<small>Локальное рабочее место</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            <span className="topbar-project">Учебная программа</span>
            <span className="slash">/</span>
            {nav.find((n) => n.id === view)?.label ?? "Методология"}
          </span>
          <span className="local-status">
            <i />
            Локальный режим
          </span>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                DATA-DRIVEN CURRICULUM <span> / </span> OQY
              </div>
              <h1>{title}</h1>
              <p>
                {view === "overview"
                  ? "От результатов тестирования — к обоснованным решениям."
                  : view === "books"
                    ? "Сопоставьте результаты по общим темам учебной программы."
                    : view === "plan"
                      ? "Перераспределите нагрузку, сохраняя общий бюджет часов."
                      : view === "data"
                        ? "Загрузите результаты тестирования и начните анализ."
                        : "Прозрачные формулы. Проверяемые выводы."}
              </p>
            </div>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={17} />
              Загрузить CSV
            </button>
            <input
              ref={fileInput}
              aria-label="CSV с результатами"
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => void importFile(e.target.files?.[0])}
            />
          </div>
          {error.length > 0 && (
            <div className="notice error" role="alert">
              <div>
                <strong>Не удалось загрузить данные</strong>
                {error.slice(0, 5).map((e, i) => (
                  <p key={i}>{e}</p>
                ))}
                {error.length > 5 && <p>И ещё {error.length - 5} ошибок.</p>}
                <small>
                  Предыдущий набор сохранён. Исправьте CSV и загрузите повторно.
                </small>
              </div>
              <button
                className="icon-btn"
                aria-label="Закрыть ошибку"
                onClick={() => setError([])}
              >
                <X size={18} />
              </button>
            </div>
          )}
          {message && (
            <div className="notice success" role="status">
              <Check size={17} />
              {message}
              <button
                className="icon-btn"
                aria-label="Закрыть уведомление"
                onClick={() => setMessage("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div className="dataset-bar">
            <span className="dataset-label">
              <span className={`status-dot ${isDemo ? "" : "real"}`} />
              {isDemo ? "ДЕМО-ДАННЫЕ" : "ВАШ НАБОР"}
              <span className="dataset-description">
                {isDemo
                  ? "Синтетический набор · для знакомства с платформой"
                  : source}
              </span>
            </span>
            <button className="text-button" onClick={() => setView("data")}>
              О данных <ArrowRight size={14} />
            </button>
          </div>
          {view !== "data" && view !== "method" && (
            <div className="filters">
              <div className="filter-fields">
                <label>
                  Предмет
                  <select
                    aria-label="Предмет"
                    value={subject}
                    onChange={(e) => changeSubject(e.target.value)}
                  >
                    {subjects.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Класс
                  <select
                    aria-label="Класс"
                    value={grade}
                    onChange={(e) => {
                      setGrade(e.target.value);
                      setSchool("all");
                      setBudget(undefined);
                    }}
                  >
                    {grades.map((g) => (
                      <option key={g} value={g}>
                        {g} класс
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Школа
                  <select
                    aria-label="Школа"
                    value={school}
                    onChange={(e) => {
                      setSchool(e.target.value);
                      setBudget(undefined);
                    }}
                  >
                    {<option value="all">Все школы</option>}
                    {schools.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </div>
              {a && (
                <Report
                  analysis={a}
                  source={source}
                  subject={subject}
                  grade={grade}
                  school={school}
                />
              )}
            </div>
          )}
          {busy && (
            <div className="notice" role="status">
              Обрабатываем данные…
            </div>
          )}
          {result.error && (
            <div className="notice error" role="alert">
              {result.error}
              <button
                onClick={() => setBudget(undefined)}
                className="text-button"
              >
                Сбросить бюджет
              </button>
            </div>
          )}
          {!busy &&
            !filtered.length &&
            view !== "data" &&
            view !== "method" && (
              <section className="empty-state">
                <Database size={36} />
                <h2>Пока нет результатов</h2>
                <p>Загрузите CSV или откройте демонстрационный набор.</p>
                <button className="btn primary" onClick={() => void loadDemo()}>
                  Открыть демо
                </button>
              </section>
            )}
          {a && filtered.length > 0 && view === "overview" && (
            <>
              <div className="metrics">
                <Metric
                  icon={<Users size={18} />}
                  label="Учеников в выборке"
                  value={String(a.students)}
                  detail={`${a.schools} школы · ${filtered.length} результатов`}
                />
                <Metric
                  icon={<BarChart3 size={18} />}
                  label="Средний результат"
                  value={`${pct(a.mean)}%`}
                  detail="От максимального балла"
                  accent
                />
                <Metric
                  icon={<BookOpen size={18} />}
                  label="Требуют внимания"
                  value={`${weak.length}`}
                  detail={`из ${a.topics.length} тем · результат ниже 70%`}
                  warning
                />
                <Metric
                  icon={<Clock3 size={18} />}
                  label="Учебных часов"
                  value={String(a.totalHours)}
                  detail="В текущем учебном плане"
                />
              </div>
              <div className="overview-grid">
                <section className="panel topics-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Усвоение по темам</h2>
                      <p>Средний балл от максимального, %</p>
                    </div>
                    <span className="mini-label">{a.topics.length} ТЕМ</span>
                  </div>
                  <div className="chart-legend">
                    <span>
                      <i className="legend-dot green" />
                      70% и выше
                    </span>
                    <span>
                      <i className="legend-dot amber" />
                      Требует внимания
                    </span>
                    <span className="target-label">Ориентир — 70%</span>
                  </div>
                  <div className="topic-chart">
                    {sorted.map((t) => (
                      <button
                        key={t.topic}
                        className="topic-row"
                        onClick={() => setSelectedTopic(t.topic)}

                      >
                        <span className="topic-name">{t.topic}</span>
                        <span className="bar-track">
                          <span
                            className={`bar-fill ${t.mean < 70 ? "amber" : ""}`}
                            style={{ width: `${t.mean}%` }}
                          />
                          <span className="target-line" />
                        </span>
                        <strong>
                          {pct(t.mean)}
                          <span>%</span>
                        </strong>
                      </button>
                    ))}
                    <div className="chart-axis">
                      <span>0</span>
                      <span>25</span>
                      <span>50</span>
                      <span>75</span>
                      <span>100%</span>
                    </div>
                  </div>
                  <div className="panel-foot">
                    <span>
                      <span className="tiny-dot" />
                      Нажмите на тему, чтобы увидеть детали
                    </span>
                    <span>{filtered.length} наблюдений</span>
                  </div>
                </section>
                <section className="insight-panel">
                  <div className="insight-top">
                    <span>
                      <Sparkles size={16} />
                      ФОКУС МЕТОДИСТА
                    </span>
                    <ArrowUpRight size={21} />
                  </div>
                  <div className="insight-symbol">
                    <Leaf size={36} strokeWidth={1.4} />
                  </div>
                  <h2>
                    {sorted[0]?.topic ?? "Учебная программа"} —<br />
                    точка роста
                  </h2>
                  <p>
                    Средний результат —{" "}
                    <strong>{pct(sorted[0]?.mean ?? 0)}%</strong>. Это самая
                    сложная тема в текущей выборке.
                  </p>
                  <div className="insight-stat">
                    <span>Предложение по часам</span>
                    <strong>
                      {sorted[0]?.currentHours}
                      <ArrowRight size={22} />
                      {sorted[0]?.recommendedHours}
                      <small>ч.</small>
                    </strong>
                  </div>
                  <button className="btn lime" onClick={() => setView("plan")}>
                    Посмотреть план <ArrowRight size={17} />
                  </button>
                  <small className="insight-disclaimer">
                    Рекомендация по данным, решение — за вами.
                  </small>
                </section>
              </div>
              {activeTopic && (
                <section className="panel topic-detail">
                  <div>
                    <h2>{activeTopic.topic}</h2>
                    <p>
                      {activeTopic.students} учеников · {activeTopic.count}{" "}
                      результатов · средний балл {pct(activeTopic.mean)}%
                    </p>
                    <p>
                      Порог 70% достигнут в {pct(activeTopic.mastery)}%
                      результатов. Текущие часы: {activeTopic.currentHours};
                      предложено: {activeTopic.recommendedHours}.
                    </p>
                  </div>
                  <button
                    className="icon-btn"
                    aria-label="Закрыть подробности"
                    onClick={() => setSelectedTopic(null)}
                  >
                    <X size={18} />
                  </button>
                </section>
              )}
              <section className="panel bottom-panel">
                <div className="panel-heading">
                  <div>
                    <h2>За цифрами — следующий шаг</h2>
                    <p>Два инструмента для решений по учебной программе</p>
                  </div>
                  <span className="mini-label">ОТ АНАЛИЗА К ДЕЙСТВИЮ</span>
                </div>
                <div className="action-grid">
                  <button onClick={() => setView("books")}>
                    <span className="action-icon">
                      <BookOpen size={22} />
                    </span>
                    <span>
                      <strong>Какой учебник помогает лучше?</strong>
                      <small>
                        Сравните {a.books.length} учебника по одинаковым темам
                      </small>
                    </span>
                    <ArrowUpRight size={20} />
                  </button>
                  <button onClick={() => setView("plan")}>
                    <span className="action-icon peach">
                      <SlidersHorizontal size={22} />
                    </span>
                    <span>
                      <strong>Куда направить учебные часы?</strong>
                      <small>Сбалансируйте план с учётом сложных тем</small>
                    </span>
                    <ArrowUpRight size={20} />
                  </button>
                </div>
              </section>
            </>
          )}
          {a && filtered.length > 0 && view === "books" && (
            <>
              <div className="notice">
                <BookOpen size={20} />
                <span>
                  Для сопоставления используются{" "}
                  <strong>{a.commonTopics.length} общих тем</strong> с
                  одинаковым весом. Выбранные школа, предмет и класс применяются
                  к обоим учебникам.
                </span>
              </div>
              <div className="book-grid">
                {a.books.map((b, i) => (
                  <section className="panel book-card" key={b.textbook}>
                    <span className={`book-cover cover-${i % 2}`}>
                      <BookOpen size={38} />
                      <small>УЧЕБНЫЙ МАТЕРИАЛ</small>
                      <strong>{b.textbook}</strong>
                    </span>
                    <div>
                      <span className="mini-label">
                        {isDemo ? "ВЫМЫШЛЕННЫЙ УЧЕБНИК" : "УЧЕБНИК"}
                      </span>
                      <h2>{b.textbook}</h2>
                      <div className="book-score">
                        {b.adjustedMean === null
                          ? "—"
                          : `${pct(b.adjustedMean)}%`}
                      </div>
                      <p>Среднее по общим темам</p>
                      <div className="book-meta">
                        <span>{b.students} учеников</span>
                        <span>{b.count} результатов</span>
                      </div>
                      <small>Среднее по всем результатам: {pct(b.mean)}%</small>
                    </div>
                  </section>
                ))}
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Сравнение по темам</h2>
                    <p>
                      Средний нормализованный балл · размер выборки в скобках
                    </p>
                  </div>
                </div>
                <div className="table-wrap" tabIndex={0} role="region" aria-label="Таблица результатов">
                  <table>
                    <thead>
                      <tr>
                        <th>Тема</th>
                        {a.books.map((b) => (
                          <th key={b.textbook}>{b.textbook}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {a.topics.map((t) => (
                        <tr key={t.topic}>
                          <td>{t.topic}</td>
                          {a.books.map((b) => {
                            const items = filtered.filter(
                              (r) =>
                                r.topic === t.topic &&
                                r.textbook === b.textbook,
                            );
                            return (
                              <td key={b.textbook}>
                                {items.length ? (
                                  <>
                                    <strong>
                                      {pct(
                                        items.reduce(
                                          (s, r) =>
                                            s + (r.score / r.max_score) * 100,
                                          0,
                                        ) / items.length,
                                      )}
                                      %
                                    </strong>{" "}
                                    <small>({items.length})</small>
                                  </>
                                ) : (
                                  "Нет данных"
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <div className="notice muted">
                <ShieldCheck size={20} />
                <span>
                  Разница в результатах не доказывает влияние учебника. На неё
                  могут влиять подготовка учеников, учитель и условия школы. Для
                  выводов об эффективности нужен контролируемый пилот.
                </span>
              </div>
            </>
          )}
          {a && filtered.length > 0 && view === "plan" && (
            <>
              <section className="plan-banner">
                <div>
                  <span className="eyebrow">СЦЕНАРИЙ РАСПРЕДЕЛЕНИЯ</span>
                  <h2>Тот же ресурс. Больше внимания сложным темам.</h2>
                  <p>
                    Минимум один час на тему. Итоговая сумма точно совпадает с
                    бюджетом.
                  </p>
                </div>
                <label className="budget-control">
                  Бюджет часов
                  <input
                    aria-label="Бюджет часов"
                    type="number"
                    min={a.topics.length}
                    max={100000}
                    step={1}
                    value={budgetDraft}
                    onChange={(e) => setBudgetDraft(e.target.value)}
                    onBlur={applyBudget}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") applyBudget();
                    }}
                    aria-invalid={!!budgetError}
                    aria-describedby={budgetError ? "budget-error" : undefined}
                  />
                </label>
              </section>
              {budgetError && (
                <div id="budget-error" className="notice error" role="alert">
                  {budgetError}
                </div>
              )}
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Предлагаемый учебный план</h2>
                    <p>
                      Вес темы учитывает текущие часы и разрыв до 100%
                      результата
                    </p>
                  </div>
                  <button className="btn secondary" onClick={exportPlan}>
                    <ArrowDownToLine size={16} />
                    Скачать план CSV
                  </button>
                </div>
                <div className="table-wrap" tabIndex={0} role="region" aria-label="Таблица результатов">
                  <table>
                    <thead>
                      <tr>
                        <th>Тема программы</th>
                        <th>Результат</th>
                        <th>Сейчас, ч.</th>
                        <th>План, ч.</th>
                        <th>Изменение</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((t) => (
                        <tr key={t.topic}>
                          <td>
                            <strong>{t.topic}</strong>
                            <small className="table-sub">
                              {t.count} результатов
                            </small>
                          </td>
                          <td>
                            <span
                              className={`score-pill ${t.mean < 70 ? "warm" : ""}`}
                            >
                              {pct(t.mean)}%
                            </span>
                          </td>
                          <td>{t.currentHours}</td>
                          <td>
                            <strong>{t.recommendedHours}</strong>
                          </td>
                          <td>
                            <span
                              className={`delta ${t.delta > 0 ? "positive" : t.delta < 0 ? "negative" : ""}`}
                            >
                              {t.delta > 0 ? "+" : ""}
                              {t.delta === 0
                                ? "Без изменений"
                                : `${t.delta} ч.`}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>Всего часов</td>
                        <td />
                        <td>{a.totalHours}</td>
                        <td>{a.recommendedTotal}</td>
                        <td>
                          <span className="conserved">
                            <Check size={15} />
                            Бюджет соблюдён
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
              <div className="notice muted">
                <CircleHelp size={20} />
                <span>
                  Это сценарий для обсуждения с педагогом. Он не меняет
                  официальный учебный план и не прогнозирует рост успеваемости.{" "}
                  <button
                    className="text-button"
                    onClick={() => setView("method")}
                  >
                    Формула расчёта →
                  </button>
                </span>
              </div>
            </>
          )}
          {view === "data" && (
            <>
              <div className="data-grid">
                <section className="panel upload-panel">
                  <span className="upload-icon">
                    <FileSpreadsheet size={32} />
                  </span>
                  <h2>От таблицы — к картине обучения</h2>
                  <p>
                    CSV в UTF-8, до 5 МБ и 20 000 строк.
                    <br />
                    Разделитель — запятая или точка с запятой.
                  </p>
                  <button
                    className="btn primary"
                    onClick={() => fileInput.current?.click()}
                    disabled={busy}
                  >
                    <Plus size={17} />
                    Выбрать CSV
                  </button>
                  <a className="text-button" href="/data/template.csv" download>
                    Скачать шаблон <ArrowDownToLine size={15} />
                  </a>
                </section>
                <section className="panel data-info">
                  <span className="mini-label">АКТИВНЫЙ ИСТОЧНИК</span>
                  <h2>{source}</h2>
                  <p>
                    {rows.length} результатов ·{" "}
                    {new Set(rows.map((r) => r.student_id)).size} учеников
                  </p>
                  <div className="notice muted">
                    <ShieldCheck size={20} />
                    <span>
                      Файл остаётся в памяти этой вкладки. После обновления
                      страницы открывается демо. Данные не сохраняются на
                      сервере.
                    </span>
                  </div>
                  <button
                    className="btn secondary"
                    onClick={() => {
                      void loadDemo();
                      setMessage("");
                    }}
                  >
                    Восстановить демо-набор
                  </button>
                  <a className="text-button" href="/data/demo.csv" download>
                    Скачать демо CSV <ArrowDownToLine size={15} />
                  </a>
                </section>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Структура данных</h2>
                    <p>Одна строка — один результат ученика по теме</p>
                  </div>
                </div>
                <div className="table-wrap" tabIndex={0} role="region" aria-label="Таблица результатов">
                  <table>
                    <thead>
                      <tr>
                        <th>Поле</th>
                        <th>Что указать</th>
                        <th>Пример</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        [
                          "student_id",
                          "Обезличенный уникальный код ученика",
                          "S001",
                        ],
                        ["school", "Школа или её код", "Школа 01"],
                        ["grade", "Класс", "7"],
                        ["subject", "Предмет", "Математика"],
                        ["topic", "Тема учебной программы", "Дроби"],
                        ["textbook", "Название учебника", "Оқулық A"],
                        [
                          "score / max_score",
                          "Набранный / максимальный балл",
                          "12 / 20",
                        ],
                        [
                          "hours",
                          "Текущие часы по теме; одинаковые для одной программы",
                          "6",
                        ],
                      ].map((r) => (
                        <tr key={r[0]}>
                          <td>
                            <code>{r[0]}</code>
                          </td>
                          <td>{r[1]}</td>
                          <td>{r[2]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <div className="notice muted">
                Демо содержит только синтетические данные: 144 ученика, 3
                условные школы, 2 вымышленных учебника. Это проверка работы
                продукта, а не исследование реальных школ.
              </div>
            </>
          )}
          {view === "method" && (
            <div className="method-grid">
              {[
                [
                  "01",
                  "Единый масштаб",
                  "Каждый результат = score / max_score × 100%. Средний результат — среднее по строкам выбранной выборки. Доля достижения порога — доля результатов не ниже 70%.",
                ],
                [
                  "02",
                  "Темы требуют внимания",
                  "Ориентир интерфейса — 70%. Это рабочий порог демонстрации, а не норматив. Размер выборки всегда указан; небольшая выборка требует осторожности.",
                ],
                [
                  "03",
                  "Сопоставимые учебники",
                  "Берём только темы, присутствующие у всех выбранных учебников. Сначала считаем среднее внутри темы, затем усредняем темы с одинаковым весом. Без общих тем сравнение не строится.",
                ],
                [
                  "04",
                  "План с фиксированным бюджетом",
                  "Каждой теме выделяется 1 час. Остаток распределяется пропорционально весу: текущие часы × (1 + 3 × (100 − средний результат) / 100). Целые часы назначаются методом наибольших остатков.",
                ],
                [
                  "05",
                  "Границы выводов",
                  "Анализ описательный, без причинных выводов. Различия между учениками, учителями и тестами не контролируются. План — прозрачная эвристика, которую утверждает методист.",
                ],
                [
                  "06",
                  "Архитектура и приватность",
                  "React + TypeScript. Парсинг, проверка CSV и расчёты выполняются в браузере. Без генеративной модели, внешних API и передачи результатов на сервер.",
                ],
              ].map(([n, h, p]) => (
                <section className="panel method-card" key={n}>
                  <span>{n}</span>
                  <h2>{h}</h2>
                  <p>{p}</p>
                </section>
              ))}
            </div>
          )}
          {a &&
            a.warnings.length > 0 &&
            view !== "data" &&
            view !== "method" && (
              <details className="quality-details">
                <summary>
                  О качестве данных и ограничениях ({a.warnings.length})
                </summary>
                <ul>
                  {a.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
          <footer>
            <span>
              <BookOpen size={14} />
              OQY · Решения на основе данных
            </span>
            <span>
              ZHAMBYL HUB <span className="footer-divider">/</span> HACKATHON
              2026
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function Metric({
  icon,
  label,
  value,
  detail,
  accent,
  warning,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
  warning?: boolean;
}) {
  return (
    <section className={`metric ${accent ? "accent" : ""}`}>
      <div className="metric-label">
        {label}
        <span>{icon}</span>
      </div>
      <strong>
        {value}
        {warning && <span className="attention-dot" />}
      </strong>
      <p>{detail}</p>
    </section>
  );
}
