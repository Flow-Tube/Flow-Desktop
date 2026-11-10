export interface DetailRow {
  label: string;
  value: string;
  /** An id or codec, shown in the technical face. */
  mono?: boolean;
}

interface DetailRowsProps {
  rows: DetailRow[];
  /** Makes each row a button; without it the values can be selected. */
  onRowClick?: (row: DetailRow) => void;
  rowLabel?: (row: DetailRow) => string;
}

function Row({ row }: { row: DetailRow }) {
  return (
    <>
      <dt className="text-xs font-semibold text-chrome-neutral-500">{row.label}</dt>
      <dd className={`break-words text-sm text-chrome-neutral-100 ${row.mono ? "font-mono" : "tabular-nums"}`}>{row.value}</dd>
    </>
  );
}

/** Labelled facts about something, in the details dialogs. */
export function DetailRows({ rows, onRowClick, rowLabel }: DetailRowsProps) {
  return (
    <dl className={`flex flex-col ${onRowClick ? "" : "gap-3 select-text"}`}>
      {rows.map((row) =>
        onRowClick ? (
          <button
            key={row.label}
            type="button"
            onClick={() => onRowClick(row)}
            aria-label={rowLabel?.(row)}
            className="flex flex-col gap-0.5 rounded-lg px-2 py-2 text-start transition-colors duration-200 ease-out hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Row row={row} />
          </button>
        ) : (
          <div key={row.label}>
            <Row row={row} />
          </div>
        ),
      )}
    </dl>
  );
}
