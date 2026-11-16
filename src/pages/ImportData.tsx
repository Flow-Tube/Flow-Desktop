import React, { useState } from "react";
import { Upload, Check, AlertCircle, FolderHeart, Heart, History, Tv, Loader2, Brain, Database, FileText, SlidersHorizontal, StickyNote } from "lucide-react";
import { SettingsGroup } from "../components/settings/SettingsGroup";
import { SettingItem } from "../components/settings/SettingItem";
import { ToggleSwitch } from "../components/ui/ToggleSwitch";
import { pickFile } from "../lib/dialogs";
import { getString } from "../lib/i18n/index";
import { IMPORT_EVERYTHING, IMPORT_FILE_EXTENSIONS, importFile, type ImportCounts, type ImportSelection, type ImportStage } from "../lib/backup/importFile";
import { ImportSourceChooser } from "../components/import/ImportSourceChooser";
import { ImportCountsList } from "../components/import/ImportCountsList";

export const ImportData: React.FC = () => {
  const [selection, setSelection] = useState<ImportSelection>(IMPORT_EVERYTHING);
  const [importState, setImportState] = useState<"idle" | ImportStage | "success" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [counts, setCounts] = useState<ImportCounts | null>(null);

  const handleCardClick = () => {
    if (["reading", "parsing", "saving"].includes(importState)) return;
    void pickAndImport();
  };

  const pickAndImport = async () => {
    const path = await pickFile(getString("import_select_file"), [{ name: getString("import_supported_formats_title"), extensions: IMPORT_FILE_EXTENSIONS }]);
    if (!path) return;
    setErrorMessage("");
    setCounts(null);
    try {
      const result = await importFile(path, selection, ({ stage, percent, message }) => {
        setImportState(stage);
        setProgress(percent);
        setStatusMessage(message);
      });
      if (result.type === "cancelled") { setImportState("idle"); setProgress(0); return; }
      setCounts(result.counts);
      setImportState("success");
    } catch (err: any) { console.error("Import failure", err); setImportState("error"); setErrorMessage(err?.message || getString("import_file_not_recognized")); }
  };

  const toggle = (key: keyof ImportSelection) => setSelection((current) => ({ ...current, [key]: !current[key] }));

  const toggleItems: { key: keyof ImportSelection; label: string; desc: string; icon: React.ReactNode }[] = [
    { key: "settings", label: getString("import_settings"), desc: getString("import_settings_desc"), icon: <SlidersHorizontal size={16} /> },
    { key: "subscriptions", label: getString("import_subscriptions"), desc: getString("import_subscriptions_desc"), icon: <Tv size={16} /> },
    { key: "playlists", label: getString("import_playlists"), desc: getString("import_playlists_desc"), icon: <FolderHeart size={16} /> },
    { key: "history", label: getString("import_watch_history"), desc: getString("import_watch_history_desc"), icon: <History size={16} /> },
    { key: "likes", label: getString("import_likes"), desc: getString("import_likes_desc"), icon: <Heart size={16} /> },
    { key: "notes", label: getString("import_notes"), desc: getString("import_notes_desc"), icon: <StickyNote size={16} /> },
    { key: "neuro", label: getString("import_neuro_profile"), desc: getString("import_neuro_profile_desc"), icon: <Brain size={16} /> },
  ];

  const formatItems = [
    { label: getString("import_format_flow"), ext: ".zip / .json" },
    { label: getString("import_format_takeout"), ext: ".zip / .csv / .html / .json" },
    { label: getString("import_format_newpipe"), ext: ".zip / .db / .json" },
    { label: getString("import_format_libretube"), ext: ".json" },
    { label: getString("import_format_freetube"), ext: ".db / .json (NDJSON)" },
    { label: getString("import_format_metrolist"), ext: ".zip" },
    { label: getString("import_format_opml"), ext: ".xml / .opml" },
  ];

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-8 pb-20 md:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100">{getString("import_title")}</h1>
        <p className="mt-1 text-sm text-chrome-neutral-400">{getString("import_subtitle")}</p>
      </header>

      <div className="grid grid-cols-12 gap-4 md:gap-6">
        <div className="col-span-12 space-y-6 lg:col-span-7">
          {importState === "idle" && (
            <SettingsGroup title={getString("import_data_to_import")}>
              {toggleItems.map((item) => (
                <SettingItem key={item.key} icon={item.icon} title={item.label} description={item.desc}>
                  <ToggleSwitch checked={selection[item.key]} onChange={() => toggle(item.key)} />
                </SettingItem>
              ))}
            </SettingsGroup>
          )}

          <div
            onClick={handleCardClick}
            className={`flex min-h-[280px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed text-center transition-colors duration-200 ease-out ${
              ["reading", "parsing", "saving"].includes(importState) ? "pointer-events-none border-chrome-neutral-800 bg-surface-container-low"
              : importState === "success" ? "border-chrome-emerald-900 bg-surface-container-low hover:bg-surface-container"
              : importState === "error" ? "border-chrome-red-900 bg-surface-container-low hover:bg-surface-container"
              : "border-chrome-neutral-700 bg-surface-container-low hover:border-chrome-neutral-600 hover:bg-surface-container"
            }`}
          >
            {importState === "idle" && (
              <div className="space-y-3 p-8">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-chrome-neutral-800 bg-surface-container-high">
                  <Upload className="h-5 w-5 text-chrome-neutral-400" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-base font-medium text-chrome-neutral-200">{getString("import_select_file")}</h4>
                  <p className="mx-auto max-w-sm text-xs text-chrome-neutral-400">{getString("import_supported_formats")}</p>
                </div>
              </div>
            )}

            {["reading", "parsing", "saving"].includes(importState) && (
              <div className="w-full max-w-md space-y-4 px-8 py-8">
                <div className="flex items-center justify-between text-xs font-medium text-chrome-neutral-400">
                  <span>{statusMessage}</span>
                  <span className="font-mono text-chrome-neutral-300">{progress}%</span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-surface-container-high">
                  <div className="h-full bg-[var(--color-primary)] transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
                </div>
                <div className="flex items-center justify-center gap-2 text-xs text-chrome-neutral-500">
                  <Loader2 size={12} className="animate-spin" />
                  {getString("import_processing")}
                </div>
              </div>
            )}

            {importState === "success" && (
              <div className="space-y-3 p-8">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-chrome-emerald-900 bg-surface-container-high">
                  <Check className="h-5 w-5 text-chrome-emerald-500" />
                </div>
                <h4 className="text-base font-medium text-chrome-neutral-200">{getString("import_complete")}</h4>
                {counts && <ImportCountsList counts={counts} />}
                <p className="text-xs text-chrome-neutral-500">{getString("import_click_another")}</p>
              </div>
            )}

            {importState === "error" && (
              <div className="space-y-3 p-8">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-chrome-red-900 bg-surface-container-high">
                  <AlertCircle className="h-5 w-5 text-chrome-red-400" />
                </div>
                <h4 className="text-base font-medium text-chrome-red-400">{getString("import_failed")}</h4>
                <p className="mx-auto max-w-sm text-xs text-chrome-neutral-400">{errorMessage || getString("import_file_not_recognized")}</p>
                <p className="text-xs text-chrome-neutral-500">{getString("import_try_another")}</p>
              </div>
            )}
          </div>
        </div>

        <div className="col-span-12 space-y-6 lg:col-span-5">
          <ImportSourceChooser disabled={["reading", "parsing", "saving"].includes(importState)} />

          <SettingsGroup title={getString("import_supported_formats_title")}>
            {formatItems.map((format) => (
              <SettingItem key={format.label} icon={<FileText size={16} />} title={format.label}>
                <span className="font-mono text-xs text-chrome-neutral-500">{format.ext}</span>
              </SettingItem>
            ))}
          </SettingsGroup>

          <div className="rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-5">
            <div className="mb-3 flex items-center gap-2">
              <Database size={14} className="text-chrome-neutral-400" />
              <h4 className="text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">{getString("import_flowneuro_card_title")}</h4>
            </div>
            <p className="text-xs leading-relaxed text-chrome-neutral-400">
              {getString("import_flowneuro_card_body")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImportData;
