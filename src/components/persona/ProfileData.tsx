import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Download, Loader2, RotateCcw, Upload } from "lucide-react";
import type { UserBrain } from "../../lib/api/recommendation";
import {
  convertFlowNeuroBrainData,
  extractFlowNeuroBrainCandidate,
  isFlowNeuroBrainCandidate,
} from "../../lib/flowNeuroImport";
import { getString } from "../../lib/i18n/index";

interface ProfileDataProps {
  brain: UserBrain;
  onImport: (importedBrain: UserBrain) => Promise<void>;
  onReset: () => Promise<void>;
}

export function ProfileData({ brain, onImport, onReset }: ProfileDataProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showNotification = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  const handleExport = () => {
    try {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(brain, null, 2));
      const downloadAnchor = document.createElement("a");
      const timestamp = new Date().toISOString().replace(/[-:T.]/g, "_").slice(0, 15);
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `flow_brain_${timestamp}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();

      showNotification("success", getString("persona_export_success"));
    } catch (e) {
      console.error(e);
      showNotification("error", getString("persona_export_failed"));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text) as unknown;
        const brainCandidate = extractFlowNeuroBrainCandidate(parsed);

        if (!brainCandidate || !isFlowNeuroBrainCandidate(brainCandidate)) {
          throw new Error(getString("persona_import_invalid"));
        }

        await onImport(convertFlowNeuroBrainData(brainCandidate));
        showNotification("success", getString("persona_import_success"));
      } catch (err: any) {
        console.error("Brain import parse failed:", err);
        showNotification("error", err?.message || getString("persona_import_failed"));
      } finally {
        setIsImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };

    reader.onerror = () => {
      showNotification("error", getString("persona_import_read_failed"));
      setIsImporting(false);
    };

    reader.readAsText(file);
  };

  const handleResetConfirm = async () => {
    setIsResetting(true);
    try {
      await onReset();
      setShowConfirmReset(false);
      showNotification("success", getString("persona_reset_success"));
    } catch (e) {
      showNotification("error", getString("persona_reset_failed"));
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <section className="w-full rounded-2xl bg-[var(--color-surface-container-low)] border border-[var(--color-outline-variant)] p-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold text-[var(--color-on-surface)]">{getString("persona_data_title")}</h3>
        <p className="text-sm text-[var(--color-on-surface-variant)]">
          {getString("persona_data_desc")}
        </p>
      </div>

      {notification && (
        <div
          className={`mt-5 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${
            notification.type === "success"
              ? "border-[var(--color-outline-variant)] bg-[var(--color-surface-container)] text-[var(--color-on-surface)]"
              : "border-chrome-red-900/50 bg-chrome-red-950/30 text-chrome-red-400"
          }`}
        >
          {notification.type === "success" ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {notification.message}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3">
        <button
          onClick={handleExport}
          className="flex items-center gap-3 rounded-xl border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-high)] px-4 py-3 text-left text-[var(--color-on-surface)] transition-colors hover:bg-[var(--color-surface-container-highest)]"
        >
          <Download className="h-4 w-4 text-[var(--color-on-surface-variant)]" />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">{getString("persona_export")}</span>
            <span className="text-xs text-[var(--color-on-surface-variant)]">{getString("persona_export_desc")}</span>
          </span>
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isImporting}
          className="flex items-center gap-3 rounded-xl border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-high)] px-4 py-3 text-left text-[var(--color-on-surface)] transition-colors hover:bg-[var(--color-surface-container-highest)] disabled:opacity-50"
        >
          {isImporting ? (
            <Loader2 className="h-4 w-4 animate-spin text-[var(--color-on-surface-variant)]" />
          ) : (
            <Upload className="h-4 w-4 text-[var(--color-on-surface-variant)]" />
          )}
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">{getString(isImporting ? "persona_importing" : "persona_import")}</span>
            <span className="text-xs text-[var(--color-on-surface-variant)]">{getString("persona_import_desc")}</span>
          </span>
          <input ref={fileInputRef} type="file" onChange={handleFileChange} accept=".json" className="hidden" />
        </button>

        <button
          onClick={() => setShowConfirmReset(true)}
          className="flex items-center gap-3 rounded-xl border border-chrome-red-900/50 bg-chrome-red-950/30 px-4 py-3 text-left text-chrome-red-400 transition-colors hover:bg-chrome-red-950/40"
        >
          <RotateCcw className="h-4 w-4" />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">{getString("persona_reset")}</span>
            <span className="text-xs text-chrome-red-400/70">{getString("persona_reset_desc")}</span>
          </span>
        </button>
      </div>

      {showConfirmReset && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-background)]/80 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-low)] p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-chrome-red-900/50 bg-chrome-red-950/30 text-chrome-red-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[var(--color-on-surface)]">{getString("persona_reset_confirm_title")}</h3>
                <p className="mt-1 text-sm text-[var(--color-on-surface-variant)]">
                  {getString("persona_reset_confirm_body")}
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowConfirmReset(false)}
                disabled={isResetting}
                className="rounded-full border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-high)] px-4 py-2 text-sm text-[var(--color-on-surface)] transition-colors hover:bg-[var(--color-surface-container-highest)] disabled:opacity-50"
              >
                {getString("persona_reset_keep")}
              </button>
              <button
                onClick={handleResetConfirm}
                disabled={isResetting}
                className="flex items-center gap-2 rounded-full border border-chrome-red-900/50 bg-chrome-red-950/30 px-4 py-2 text-sm text-chrome-red-400 transition-colors hover:bg-chrome-red-950/40 disabled:opacity-50"
              >
                {isResetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                {getString("persona_reset_confirm")}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
