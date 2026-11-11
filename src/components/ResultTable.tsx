import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  columnFilteringFeature,
  constructSortFn,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_includesString,
  rowSortingFeature,
  sortFn_basic,
  tableFeatures,
  useTable,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from "lucide-react";
import "./tables.css";

const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });
const features = tableFeatures({
  columnFilteringFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: { includesString: filterFn_includesString },
  sortFns: {
    text: constructSortFn({ sort: (a, b) => collator.compare(String(a), String(b)) }),
    basic: sortFn_basic,
  },
});

export interface ResultColumn<T> {
  id: string;
  label: string;
  value: (row: T) => string | number | undefined;
  render: (row: T) => ReactNode;
  text?: boolean;
}

interface ResultTableProps<T extends { topic: string }> {
  data: T[];
  columns: ResultColumn<T>[];
  label: string;
  initialSorting?: SortingState;
  footer?: ReactNode;
  scopeNote: string;
}

const noSorting: SortingState = [];

/** TanStack owns filtering and sorting; calculations and exports use the full input. */
export function ResultTable<T extends { topic: string }>({
  data,
  columns: specifications,
  label,
  initialSorting = noSorting,
  footer,
  scopeNote,
}: ResultTableProps<T>) {
  const id = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const columnFilters = useMemo(() => {
    const value = query.trim().normalize("NFC");
    return value ? [{ id: "topic", value }] : [];
  }, [query]);
  const columns = useMemo(() => {
    const helper = createColumnHelper<typeof features, T>();
    return helper.columns(specifications.map((specification) =>
      helper.accessor(specification.value, {
        id: specification.id,
        header: specification.label,
        cell: (context) => specification.render(context.row.original),
        enableColumnFilter: specification.id === "topic",
        filterFn: "includesString",
        sortFn: specification.text ? "text" : "basic",
        sortDescFirst: false,
        sortUndefined: "last",
      }),
    ));
  }, [specifications]);
  const table = useTable({
    features,
    columns,
    data,
    getRowId: (_row, index) => `topic-${index}`,
    state: { columnFilters, sorting },
    onSortingChange: setSorting,
    enableMultiSort: false,
    enableSortingRemoval: true,
  });
  const visibleRows = table.getRowModel().rows;

  return (
    <div className="results-table">
      <div className="results-table-toolbar">
        <div className="results-table-search">
          <label htmlFor={`${id}-search`}>Поиск темы</label>
          <span className="results-table-search-field">
            <Search size={17} aria-hidden="true" />
            <input
              id={`${id}-search`}
              ref={searchInput}
              name="topic-search"
              type="search"
              autoComplete="off"
              value={query}
              placeholder="Например, дроби…"
              onChange={(event) => setQuery(event.target.value)}
              aria-describedby={`${id}-scope`}
            />
            {query && (
              <button type="button" className="results-table-clear" aria-label="Очистить поиск темы" onClick={() => {
                setQuery("");
                searchInput.current?.focus();
              }}>
                <X size={17} aria-hidden="true" />
              </button>
            )}
          </span>
        </div>
        <p className="results-table-count" role="status" aria-live="polite">
          Показано тем: {visibleRows.length} из {data.length}
        </p>
      </div>
      <p className="results-table-scope" id={`${id}-scope`}>{scopeNote}</p>
      <p className="table-hint">Нажмите заголовок для сортировки. На узком экране прокрутите таблицу вправо.</p>
      <div className="table-wrap" tabIndex={0} role="region" aria-label={label} aria-describedby={`${id}-scope`}>
        <table>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const direction = header.column.getIsSorted();
                  const next = header.column.getNextSortingOrder();
                  const nextLabel = next === "asc" ? "по возрастанию" : next === "desc" ? "по убыванию" : "исходный порядок";
                  const columnLabel = specifications.find((column) => column.id === header.column.id)?.label ?? header.column.id;
                  return (
                    <th key={header.id} scope="col" aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}>
                      <button
                        type="button"
                        className="results-table-sort"
                        onClick={header.column.getToggleSortingHandler()}
                        aria-label={`${columnLabel}: ${nextLabel}`}
                        title={`${columnLabel}: ${nextLabel}`}
                      >
                        <table.FlexRender header={header} />
                        {direction === "asc" ? <ArrowUp size={16} aria-hidden="true" /> : direction === "desc" ? <ArrowDown size={16} aria-hidden="true" /> : <ArrowUpDown size={16} aria-hidden="true" />}
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id}>
                {row.getAllCells().map((cell) => (
                  <td key={cell.id}><table.FlexRender cell={cell} /></td>
                ))}
              </tr>
            ))}
            {!visibleRows.length && (
              <tr>
                <td colSpan={specifications.length} className="results-table-empty">
                  <strong>Темы не найдены</strong>
                  <p>Измените запрос или очистите поиск, чтобы увидеть все темы.</p>
                </td>
              </tr>
            )}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>
    </div>
  );
}
