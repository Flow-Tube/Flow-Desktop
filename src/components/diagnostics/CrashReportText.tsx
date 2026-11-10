import { parseCrashSummary } from "../../lib/crashReport";
import { getString } from "../../lib/i18n/index";

/** What happened in plain terms, then the full report for anyone who wants it. */
export function CrashReportText({ report }: { report: string }) {
  const summary = parseCrashSummary(report);
  const rows = [
    { label: getString("crash_summary_message"), value: summary.message, mono: false },
    { label: getString("crash_summary_where"), value: summary.where, mono: true },
    { label: getString("crash_summary_version"), value: summary.version, mono: false },
    { label: getString("crash_summary_when"), value: summary.time, mono: false },
  ];
  return (
    <div className="space-y-4">
      <dl className="space-y-1.5 rounded-xl border border-chrome-neutral-800 bg-surface-container-low p-4">
        {rows.map(
          (row) =>
            row.value && (
              <div key={row.label} className="flex gap-3 text-sm">
                <dt className="w-20 shrink-0 text-chrome-neutral-500">{row.label}</dt>
                <dd className={`min-w-0 select-text break-words text-chrome-neutral-200 ${row.mono ? "font-mono text-xs leading-5" : ""}`}>{row.value}</dd>
              </div>
            ),
        )}
      </dl>
      <div className="space-y-1">
        <h3 className="text-xs font-semibold text-chrome-neutral-500">{getString("crash_full_report")}</h3>
        <pre className="max-h-64 select-text overflow-auto rounded-xl border border-chrome-neutral-800 bg-surface-container-low p-3 font-mono text-xs leading-relaxed text-chrome-neutral-300">
          {report}
        </pre>
      </div>
    </div>
  );
}
