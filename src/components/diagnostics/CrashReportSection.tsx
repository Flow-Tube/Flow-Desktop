import { Bug, Copy, Trash2 } from "lucide-react";

import { copyText } from "../../lib/clipboard";
import { sendCrashReport, useCrashReport } from "../../lib/crashReport";
import { getString } from "../../lib/i18n/index";
import { useUiStore } from "../../store/useUiStore";
import { Button } from "../ui/Button";
import { CrashReportText } from "./CrashReportText";

/** The last crash's report on the Diagnostics page; nothing shows when there isn't one. */
export function CrashReportSection() {
  const { file, remove } = useCrashReport();
  const showToast = useUiStore((state) => state.showToast);
  if (!file) return null;

  const copy = async () => {
    const ok = await copyText(file.report);
    showToast({ variant: ok ? "success" : "error", message: getString(ok ? "diagnostics_copied" : "diagnostics_copy_failed") });
  };
  const deleteReport = () => {
    remove().catch(() => showToast({ variant: "error", message: getString("crash_delete_failed") }));
  };

  return (
    <div className="max-w-2xl space-y-3 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-5">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">{getString("crash_last_heading")}</h3>
      <CrashReportText report={file.report} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => void sendCrashReport(file.report)}>
          <Bug size={14} />
          {getString("crash_report")}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void copy()}>
          <Copy size={14} />
          {getString("crash_copy")}
        </Button>
        <Button variant="ghost" size="sm" onClick={deleteReport}>
          <Trash2 size={14} />
          {getString("crash_delete")}
        </Button>
      </div>
    </div>
  );
}
