import { useEffect } from "react";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { useUpdaterStore } from "../../store/useUpdaterStore";
import { Button } from "../ui/Button";

/**
 * Global "update available" modal. Driven entirely by `useUpdaterStore`, mounted
 * once app-wide (see `UpdateManager`), and renders nothing until an update check
 * opens it. Mirrors the app's hand-rolled dialog convention (overlay + Escape +
 * `role="dialog"`).
 */
export function UpdateDialog() {
  const dialogOpen = useUpdaterStore((s) => s.dialogOpen);
  const phase = useUpdaterStore((s) => s.phase);
  const latestVersion = useUpdaterStore((s) => s.latestVersion);
  const currentVersion = useUpdaterStore((s) => s.currentVersion);
  const releaseNotes = useUpdaterStore((s) => s.releaseNotes);
  const progress = useUpdaterStore((s) => s.progress);
  const install = useUpdaterStore((s) => s.installUpdate);
  const skip = useUpdaterStore((s) => s.skipCurrentVersion);
  const dismiss = useUpdaterStore((s) => s.dismiss);

  const busy = phase === "downloading" || phase === "installed";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, dismiss]);

  if (!dialogOpen) return null;

  const pct = progress === null ? null : Math.round(progress * 100);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-chrome-black/70 p-4"
      onClick={() => {
        if (!busy) dismiss();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
        onClick={(event) => event.stopPropagation()}
        className="animate-fade-in w-full max-w-md rounded-2xl border border-outline-soft bg-surface-container p-6"
      >
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-surface-container-high">
            <Download className="h-6 w-6 text-[var(--color-primary)]" />
          </span>
          <div className="min-w-0">
            <h2
              id="update-dialog-title"
              className="text-lg font-bold tracking-tight text-chrome-neutral-100"
            >
              {getString("updater_update_available")}
            </h2>
            <p className="mt-1 text-sm text-chrome-neutral-400">
              {getString("updater_new_version", latestVersion ?? "")}
              {currentVersion ? ` · ${getString("updater_current_version", currentVersion)}` : ""}
            </p>
          </div>
        </div>

        {releaseNotes && (
          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
              {getString("updater_release_notes")}
            </div>
            <div className="mt-2 max-h-48 overflow-y-auto whitespace-pre-line rounded-lg bg-surface-container-low p-3 text-sm leading-relaxed text-chrome-neutral-300">
              {releaseNotes}
            </div>
          </div>
        )}

        {phase === "downloading" && (
          <div className="mt-5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-high">
              <div
                className={`h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-200 ease-out ${
                  pct === null ? "animate-pulse" : ""
                }`}
                style={{ width: pct === null ? "100%" : `${pct}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-chrome-neutral-400">
              {pct === null
                ? getString("updater_downloading")
                : `${getString("updater_downloading")} ${pct}%`}
            </p>
          </div>
        )}

        {phase === "installed" && (
          <p className="mt-5 text-sm text-chrome-neutral-300">
            {getString("updater_restarting")}
          </p>
        )}

        {phase === "error" && (
          <div className="mt-5 flex items-start gap-2 rounded-lg bg-chrome-red-950/30 p-3 text-sm text-chrome-red-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{getString("updater_error")}</span>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2">
          {phase === "error" ? (
            <>
              <Button variant="primary" onClick={() => void install()}>
                <RefreshCw className="h-4 w-4" />
                {getString("updater_retry")}
              </Button>
              <Button variant="ghost" onClick={dismiss}>
                {getString("updater_later")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" onClick={() => void install()} disabled={busy}>
                <Download className="h-4 w-4" />
                {getString("updater_download_install")}
              </Button>
              {!busy && (
                <div className="flex gap-2">
                  <Button variant="ghost" className="flex-1" onClick={dismiss}>
                    {getString("updater_later")}
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => void skip()}>
                    {getString("updater_skip_version")}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
