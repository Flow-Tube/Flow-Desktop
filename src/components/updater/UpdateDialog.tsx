import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CalendarDays, ExternalLink, FlaskConical, MoreVertical, RefreshCw, SkipForward } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { alignToEnd } from "../../lib/direction";
import { openExternal } from "../../lib/openExternal";
import { nightlyRun } from "../../lib/updateNotes";
import { useUpdaterStore } from "../../store/useUpdaterStore";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { MediaMenu } from "../ui/MediaMenu";
import type { MenuAnchor } from "../ui/AnchoredPortalMenu";
import { NoticeBanner } from "../ui/NoticeBanner";
import { formatReleaseDate, ReleaseNotesList } from "./ReleaseNotesList";

const RELEASES_URL = "https://github.com/Flow-Tube/Flow-Desktop/releases/tag/";

function releasePage(version: string): string {
  return `${RELEASES_URL}${nightlyRun(version) !== null ? "nightly" : `v${encodeURIComponent(version)}`}`;
}

function FactChip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1 text-xs font-medium text-chrome-neutral-300">
      <span className="text-chrome-neutral-400">{icon}</span>
      {children}
    </span>
  );
}

/**
 * Global "update available" dialog, laid out as Flow for Android's update page: the
 * version, what it replaces, then only the changes since this install, with the
 * download running inside the main button. Driven by `useUpdaterStore` and mounted
 * once app-wide (see `UpdateManager`).
 */
export function UpdateDialog() {
  const dialogOpen = useUpdaterStore((s) => s.dialogOpen);
  const phase = useUpdaterStore((s) => s.phase);
  const latestVersion = useUpdaterStore((s) => s.latestVersion);
  const currentVersion = useUpdaterStore((s) => s.currentVersion);
  const releaseNotes = useUpdaterStore((s) => s.releaseNotes);
  const notes = useUpdaterStore((s) => s.notes);
  const releaseDate = useUpdaterStore((s) => s.releaseDate);
  const progress = useUpdaterStore((s) => s.progress);
  const install = useUpdaterStore((s) => s.installUpdate);
  const skip = useUpdaterStore((s) => s.skipCurrentVersion);
  const dismiss = useUpdaterStore((s) => s.dismiss);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);

  const busy = phase === "downloading" || phase === "installed";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && !menu) dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, dismiss, menu]);

  if (!dialogOpen || !latestVersion) return null;

  const isNightly = nightlyRun(latestVersion) !== null;
  const isBeta = !isNightly && latestVersion.includes("-");
  const pct = progress === null ? null : Math.round(progress * 100);
  const date = releaseDate ? formatReleaseDate(releaseDate.slice(0, 10)) : null;

  const actionLabel = phase === "error"
    ? getString("updater_retry")
    : phase === "installed"
      ? getString("updater_restarting")
      : phase === "downloading"
        ? pct === null ? getString("updater_downloading") : getString("updater_downloading_percent", pct)
        : getString("updater_download_install");

  const openMenu = (button: HTMLElement) => {
    const rect = button.getBoundingClientRect();
    setMenu({ top: rect.bottom + 4, ...alignToEnd(rect), flipBottom: rect.top - 4 });
  };

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
        className="animate-fade-in flex max-h-[min(720px,85vh)] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-outline-soft bg-surface-container"
      >
        <header className="flex flex-col gap-4 px-6 pb-4 pt-6">
          <div className="flex items-start justify-between gap-4">
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-surface-container-high">
              <img src="/logo.svg" alt="" className="h-8 w-8" />
            </span>
            {!busy && (
              <IconButton aria-label={getString("more_options")} onClick={(event) => openMenu(event.currentTarget)}>
                <MoreVertical className="h-5 w-5" />
              </IconButton>
            )}
          </div>
          <h2 id="update-dialog-title" className="text-2xl font-bold tracking-tight text-chrome-neutral-100">
            {getString("updater_title", latestVersion)}
          </h2>
          <div className="flex flex-wrap gap-2">
            {currentVersion && (
              <FactChip icon={<RefreshCw className="h-3.5 w-3.5" />}>
                <span dir="ltr">{currentVersion} → {latestVersion}</span>
              </FactChip>
            )}
            {date && <FactChip icon={<CalendarDays className="h-3.5 w-3.5" />}>{date}</FactChip>}
            {(isNightly || isBeta) && (
              <FactChip icon={<FlaskConical className="h-3.5 w-3.5" />}>
                {getString(isNightly ? "updater_channel_nightly" : "updater_channel_beta")}
              </FactChip>
            )}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6">
          {phase === "error" && (
            <div className="flex items-start gap-2 rounded-2xl bg-chrome-red-950/30 p-3 text-sm text-chrome-red-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{getString("updater_error")}</span>
            </div>
          )}
          {isNightly && (
            <NoticeBanner icon={<FlaskConical className="h-4 w-4" />} message={getString("updater_nightly_notice")} />
          )}
          {notes ? (
            <div className="flex select-text flex-col gap-3">
              {notes.sinceRun !== null && (
                <p className="px-1 text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
                  {getString("updater_since_run", notes.sinceRun)}
                </p>
              )}
              <ReleaseNotesList releases={notes.releases} collapsible />
            </div>
          ) : releaseNotes ? (
            <p className="select-text whitespace-pre-line rounded-2xl bg-surface-row p-4 text-sm leading-relaxed text-chrome-neutral-300">
              {releaseNotes}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-outline-soft px-6 py-4">
          <Button variant="ghost" onClick={dismiss} disabled={busy}>
            {getString("updater_not_now")}
          </Button>
          <Button
            variant="primary"
            aria-busy={busy}
            onClick={() => {
              if (!busy) void install();
            }}
            className="relative min-w-[12rem] overflow-hidden"
          >
            {phase === "downloading" && (
              <span
                aria-hidden
                className={`absolute inset-y-0 start-0 bg-on-primary/20 transition-[width] duration-200 ease-out ${pct === null ? "animate-pulse" : ""}`}
                style={{ width: pct === null ? "100%" : `${pct}%` }}
              />
            )}
            <span className="relative tabular-nums">{actionLabel}</span>
          </Button>
        </footer>

        {menu && (
          <MediaMenu
            anchor={menu}
            onClose={() => setMenu(null)}
            className="z-[90]"
            actions={[
              { id: "skip", label: getString("updater_skip_version"), icon: <SkipForward size={18} />, group: "library", onSelect: () => void skip() },
              { id: "github", label: getString("updater_view_on_github"), icon: <ExternalLink size={18} />, group: "library", onSelect: () => void openExternal(releasePage(latestVersion)) },
            ]}
          />
        )}
      </div>
    </div>
  );
}
