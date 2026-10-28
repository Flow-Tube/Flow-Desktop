import { Check, Copy, FileCode2, FolderOpen } from "lucide-react";
import { Button } from "../ui/Button";
import { copyText } from "../../lib/clipboard";
import { getString, type StringKey } from "../../lib/i18n/index";
import type { ThemeFileStatus } from "../../lib/api/themeFile";
import { THEME_FILE_ID } from "../../lib/themeFile";
import { useTheme } from "../../lib/useTheme";
import { useThemeFile } from "../../lib/useThemeFile";
import { useUiStore } from "../../store/useUiStore";

const STATUS_LABEL: Record<Exclude<ThemeFileStatus, "loaded">, StringKey> = {
  missing: "theme_file_status_missing",
  tooLarge: "theme_file_status_too_large",
  notText: "theme_file_status_not_text",
  unreadable: "theme_file_status_unreadable",
};

/** The custom.css a desktop shell or template tool can write for Flow to follow (#81). */
export function ThemeFileSection() {
  const { themeId, setTheme } = useTheme();
  const { file, applied, error, create, reveal } = useThemeFile();
  const showToast = useUiStore((state) => state.showToast);
  const active = themeId === THEME_FILE_ID;

  const status = file?.status;
  const statusLabel = !status
    ? null
    : status === "loaded"
      ? getString(active ? "theme_file_in_use" : "theme_file_status_ready")
      : getString(STATUS_LABEL[status]);

  const chooseFile = async () => {
    if (file?.status === "missing" && !(await create())) return;
    await setTheme(THEME_FILE_ID);
  };

  const copyPath = async () => {
    if (!file) return;
    const copied = await copyText(file.path);
    showToast(copied
      ? { message: getString("theme_file_path_copied"), variant: "success" }
      : { message: getString("theme_file_copy_failed"), variant: "error" });
  };

  return (
    <section className="mt-8 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <h2 className="flex items-center gap-2 text-base font-medium text-chrome-neutral-200">
            <FileCode2 size={18} className="shrink-0 text-chrome-neutral-400" />
            {getString("theme_file")}
          </h2>
          <p className="mt-1 text-sm text-chrome-neutral-400">{getString("theme_file_description")}</p>
        </div>
        {statusLabel && (
          <span className="shrink-0 rounded-full bg-surface-container-high px-3 py-1 text-xs font-medium text-chrome-neutral-300">
            {statusLabel}
          </span>
        )}
      </div>

      {file && (
        <div className="mt-4 flex min-w-0 items-center gap-2 rounded-lg border border-chrome-neutral-800 bg-surface-container px-3 py-2">
          <code className="min-w-0 flex-1 select-text break-all font-mono text-xs text-chrome-neutral-300">{file.path}</code>
          <button
            type="button"
            onClick={() => void copyPath()}
            aria-label={getString("theme_file_copy_path")}
            title={getString("theme_file_copy_path")}
            className="shrink-0 rounded-full p-1.5 text-chrome-neutral-400 transition-colors hover:bg-surface-container-highest hover:text-chrome-neutral-100"
          >
            <Copy size={14} />
          </button>
        </div>
      )}

      {active && (
        <ul className="mt-3 space-y-1 text-xs text-chrome-neutral-400">
          {applied && status !== "loaded" && <li>{getString("theme_file_keeping_last")}</li>}
          {applied && applied.ignoredTokens.length > 0 && (
            <li>{getString("theme_file_ignored", applied.ignoredTokens.join(", "))}</li>
          )}
          {applied && applied.removedRemote > 0 && (
            <li>{getString("theme_file_removed_remote", applied.removedRemote)}</li>
          )}
        </ul>
      )}
      {error && <p className="mt-3 text-xs text-chrome-red-400">{error}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant={active ? "secondary" : "primary"} onClick={() => void chooseFile()} disabled={active}>
          {active && <Check size={17} />}
          {getString(active ? "theme_file_in_use" : "theme_file_use")}
        </Button>
        {status === "missing" && (
          <Button variant="secondary" onClick={() => void create()}>
            {getString("theme_file_create")}
          </Button>
        )}
        <Button variant="secondary" onClick={() => void reveal()}>
          <FolderOpen size={17} />
          {getString("theme_file_reveal")}
        </Button>
      </div>
    </section>
  );
}
