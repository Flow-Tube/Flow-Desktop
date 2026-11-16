import React, { useState } from "react";
import { AlertCircle, Check, Loader2, Upload } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { pickFile } from "../../lib/dialogs";
import {
  IMPORT_EVERYTHING,
  IMPORT_FILE_EXTENSIONS,
  importFile,
  type ImportCounts,
  type ImportStage,
} from "../../lib/backup/importFile";
import { ImportCountsList } from "../import/ImportCountsList";

/** First-run import: the same import as Settings › Import, taking everything in the file. */
export const ImportStep: React.FC = () => {
  const [importState, setImportState] = useState<"idle" | ImportStage | "success" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [counts, setCounts] = useState<ImportCounts | null>(null);
  const busy = importState === "reading" || importState === "parsing" || importState === "saving";

  const pickAndImport = async () => {
    if (busy) return;
    const path = await pickFile(getString("import_select_file"), [
      { name: getString("import_supported_formats_title"), extensions: IMPORT_FILE_EXTENSIONS },
    ]);
    if (!path) return;
    setErrorMessage("");
    setCounts(null);
    try {
      const result = await importFile(path, IMPORT_EVERYTHING, ({ stage, percent, message }) => {
        setImportState(stage);
        setProgress(percent);
        setStatusMessage(message);
      });
      if (result.type === "cancelled") {
        setImportState("idle");
        setProgress(0);
        return;
      }
      setCounts(result.counts);
      setImportState("success");
    } catch (err) {
      console.error("Onboarding import failed", err);
      setImportState("error");
      setErrorMessage(err instanceof Error ? err.message : "");
    }
  };

  return (
    <div className="flex flex-col w-full animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      <div className="mb-12">
        <h1 className="text-5xl font-semibold text-chrome-neutral-100 tracking-tight mb-3">
          {getString("onboarding_import_title")}
        </h1>
        <p className="text-lg text-chrome-neutral-400 max-w-2xl">
          {getString("onboarding_import_subtitle_restore")}
        </p>
      </div>

      <button
        type="button"
        onClick={() => void pickAndImport()}
        disabled={busy}
        className={`mb-8 flex min-h-[300px] w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed p-12 text-center transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          busy
            ? "cursor-default border-chrome-neutral-800 bg-surface-container-low"
            : importState === "success"
            ? "border-chrome-emerald-900 bg-surface-container-low hover:bg-surface-container"
            : importState === "error"
            ? "border-chrome-red-900 bg-surface-container-low hover:bg-surface-container"
            : "border-chrome-neutral-700 bg-surface-container-low hover:border-chrome-neutral-600 hover:bg-surface-container"
        }`}
      >
        {importState === "idle" && (
          <div className="space-y-6">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-chrome-neutral-800 bg-surface-container-high">
              <Upload className="h-7 w-7 text-chrome-neutral-400" />
            </div>
            <div className="space-y-2">
              <h4 className="text-lg font-medium text-chrome-neutral-100">{getString("onboarding_click_to_browse_files")}</h4>
              <p className="mx-auto max-w-md text-sm leading-relaxed text-chrome-neutral-400">
                {getString("onboarding_import_formats_hint")}
              </p>
            </div>
          </div>
        )}

        {busy && (
          <div className="w-full max-w-md space-y-4 px-4 select-none">
            <div className="flex items-center justify-between text-sm font-medium text-chrome-neutral-400">
              <span>{statusMessage}</span>
              <span className="font-mono tabular-nums text-chrome-neutral-300">{progress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-high">
              <div className="h-full bg-primary transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-chrome-neutral-500">
              <Loader2 size={12} className="animate-spin" />
              {getString("import_processing")}
            </div>
          </div>
        )}

        {importState === "success" && (
          <div className="space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-chrome-emerald-900 bg-surface-container-high">
              <Check className="h-7 w-7 text-chrome-emerald-500" />
            </div>
            <h4 className="text-lg font-medium text-chrome-emerald-400">{getString("onboarding_import_successful")}</h4>
            {counts && <ImportCountsList counts={counts} />}
            <p className="text-sm text-chrome-neutral-500">{getString("import_click_another")}</p>
          </div>
        )}

        {importState === "error" && (
          <div className="space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-chrome-red-900 bg-surface-container-high">
              <AlertCircle className="h-7 w-7 text-chrome-red-400" />
            </div>
            <h4 className="text-lg font-medium text-chrome-red-400">{getString("onboarding_extraction_error")}</h4>
            <p className="mx-auto max-w-md text-sm leading-relaxed text-chrome-neutral-400">
              {errorMessage || getString("onboarding_import_unrecognized")} {getString("onboarding_import_retry")}
            </p>
          </div>
        )}
      </button>

      <div className="flex flex-col space-y-4 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-6 select-none">
        <h4 className="text-xs font-semibold text-chrome-neutral-500">{getString("import_supported_formats_title")}</h4>
        <ul className="list-disc space-y-2 ps-5 text-sm leading-normal text-chrome-neutral-400">
          <li><strong>Google Takeout:</strong> {getString("onboarding_import_format_takeout")}</li>
          <li><strong>Flow:</strong> {getString("onboarding_import_format_flow")}</li>
          <li><strong>NewPipe & LibreTube:</strong> {getString("onboarding_standard_exported_json_backups")}</li>
          <li><strong>OPML / XML:</strong> {getString("onboarding_import_format_opml")}</li>
        </ul>
      </div>
    </div>
  );
};

export default ImportStep;
