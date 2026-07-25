import React, { useState } from "react";
import { Copy, Trash2, Bug, RefreshCw, FolderOpen, Save } from "lucide-react";
import { Button } from "../components/ui/Button";
import { useDiagnostics } from "../lib/useDiagnostics";
import { revealLogsFolder } from "../lib/api/diagnostics";
import { writeBackupFile } from "../lib/api/files";
import { openExternal } from "../lib/openExternal";
import { confirmAction, pickSaveFile } from "../lib/dialogs";
import { getString } from "../lib/i18n/index";
import { useUiStore } from "../store/useUiStore";

const GITHUB_ISSUES_URL = "https://github.com/FlowNeuro/Flow-Desktop/issues/new?template=bug_report.yml";

export const Diagnostics: React.FC = () => {
  const showToast = useUiStore((state) => state.showToast);
  const { text, logsDir, loading, error, refresh, clear } = useDiagnostics();
  const [busy, setBusy] = useState(false);

  const hasLogs = text.trim().length > 0;

  const copyLogs = async (): Promise<boolean> => {
    if (!hasLogs || !navigator.clipboard?.writeText) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  const handleCopy = async () => {
    const ok = await copyLogs();
    showToast({
      message: getString(ok ? "diagnostics_copied" : "diagnostics_copy_failed"),
      variant: ok ? "success" : "error",
    });
  };

  const handleReport = async () => {
    // Copy first so the user only has to paste into the issue body.
    const copied = await copyLogs();
    await openExternal(GITHUB_ISSUES_URL);
    showToast({
      message: getString(copied ? "diagnostics_report_copied" : "diagnostics_report_opened"),
      variant: "success",
    });
  };

  const handleSave = async () => {
    if (!hasLogs) return;
    try {
      const defaultName = `flow_logs_${new Date().toISOString().slice(0, 10)}.log`;
      const savePath = await pickSaveFile(getString("diagnostics_save"), defaultName, [
        { name: "Log", extensions: ["log", "txt"] },
      ]);
      if (!savePath) return;
      await writeBackupFile(savePath, text);
      showToast({ message: getString("diagnostics_saved"), variant: "success" });
    } catch {
      showToast({ message: getString("diagnostics_save_failed"), variant: "error" });
    }
  };

  const handleOpenFolder = async () => {
    try {
      await revealLogsFolder();
    } catch {
      showToast({ message: getString("diagnostics_open_folder_failed"), variant: "error" });
    }
  };

  const handleClear = async () => {
    if (!(await confirmAction(getString("diagnostics_clear_confirm"), getString("diagnostics_clear")))) {
      return;
    }
    setBusy(true);
    try {
      await clear();
      showToast({ message: getString("diagnostics_cleared"), variant: "success" });
    } catch {
      showToast({ message: getString("diagnostics_clear_failed"), variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6 pb-20 bg-[var(--color-background)]">
      <div className="border-b border-[var(--color-outline-variant)] pb-4">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-[var(--color-on-surface)]">
              {getString("diagnostics_title")}
            </h1>
            <p className="text-xs text-[var(--color-on-surface-variant)] mt-1">
              {getString("diagnostics_subtitle")}
            </p>
          </div>
        </div>
      </div>

      <p className="max-w-2xl text-sm text-chrome-neutral-400">{getString("diagnostics_description")}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={handleCopy} disabled={!hasLogs}>
          <Copy size={14} />
          {getString("diagnostics_copy")}
        </Button>
        <Button variant="secondary" size="sm" onClick={handleSave} disabled={!hasLogs}>
          <Save size={14} />
          {getString("diagnostics_save")}
        </Button>
        <Button variant="secondary" size="sm" onClick={handleOpenFolder}>
          <FolderOpen size={14} />
          {getString("diagnostics_open_folder")}
        </Button>
        <Button variant="secondary" size="sm" onClick={handleReport} disabled={!hasLogs}>
          <Bug size={14} />
          {getString("diagnostics_report_github")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={14} />
          {getString("diagnostics_refresh")}
        </Button>
        <Button variant="destructive" size="sm" onClick={handleClear} disabled={busy || !hasLogs}>
          <Trash2 size={14} />
          {getString("diagnostics_clear")}
        </Button>
      </div>

      {logsDir && (
        <p className="text-xs text-chrome-neutral-500">
          {getString("diagnostics_folder_label")}{" "}
          <code className="rounded bg-chrome-black/40 px-1.5 py-0.5 font-mono text-chrome-neutral-400">
            {logsDir}
          </code>
        </p>
      )}

      <div className="rounded-2xl border border-chrome-neutral-800 bg-surface-container-low overflow-hidden">
        <div className="px-5 py-3 border-b border-chrome-neutral-800/50 flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-widest text-chrome-neutral-500 font-semibold">
            {getString("diagnostics_logs_heading")}
          </h3>
        </div>
        <div className="max-h-[calc(100vh-360px)] min-h-[12rem] overflow-auto p-4">
          {loading ? (
            <p className="text-sm text-chrome-neutral-500">{getString("diagnostics_loading")}</p>
          ) : error ? (
            <p className="text-sm text-chrome-red-400">{error}</p>
          ) : hasLogs ? (
            <pre className="whitespace-pre font-mono text-xs leading-relaxed text-chrome-neutral-300">
              {text}
            </pre>
          ) : (
            <p className="text-sm text-chrome-neutral-500">{getString("diagnostics_empty")}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Diagnostics;
