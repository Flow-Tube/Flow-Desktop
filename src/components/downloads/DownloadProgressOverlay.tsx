import { Loader2, Pause, Play, WifiOff, X } from "lucide-react";

import {
  cancelDownload,
  pauseDownload,
  resumeDownload,
  type DownloadProgress,
} from "../../lib/api/downloads";
import { getString } from "../../lib/i18n/index";

function progressPercent(progress: DownloadProgress): number | null {
  if (!progress.totalBytes || progress.totalBytes <= 0) return null;
  return Math.max(0, Math.min(100, (progress.downloadedBytes / progress.totalBytes) * 100));
}

function statusLabel(progress: DownloadProgress): string {
  switch (progress.status) {
    case "muxing":
      return getString("download_muxing");
    case "paused":
      return getString("download_paused");
    case "waitingForNetwork":
      return getString("download_waiting_network");
    case "queued":
      return getString("download_queued");
    default:
      return getString("download_downloading_tracks");
  }
}

const CONTROL = "grid h-8 w-8 place-items-center rounded-full bg-chrome-black/50 text-chrome-neutral-100 transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/** A download running, drawn over its card's thumbnail with pause and cancel. */
export function DownloadProgressOverlay({ progress }: { progress: DownloadProgress }) {
  const percent = progressPercent(progress);
  const paused = progress.status === "paused";
  const waiting = progress.status === "waitingForNetwork";
  return (
    <div
      className="absolute inset-0 z-20 flex cursor-default flex-col justify-end bg-chrome-black/60 p-3"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-2 text-chrome-white">
        {waiting ? <WifiOff className="h-4 w-4" /> : paused ? <Pause className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
        <span className="min-w-0 flex-1 truncate text-xs font-medium tabular-nums">
          {statusLabel(progress)}
          {percent != null ? ` · ${Math.round(percent)}%` : ""}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-chrome-white/25">
        <div
          className={`h-full rounded-full bg-primary transition-[width] duration-200 ${percent == null ? "w-1/3 animate-pulse" : ""}`}
          style={percent == null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        {progress.status !== "muxing" && (
          <button
            type="button"
            aria-label={getString(paused ? "download_resume" : "download_pause")}
            onClick={() => void (paused ? resumeDownload(progress.id) : pauseDownload(progress.id))}
            className={`${CONTROL} hover:bg-chrome-black/70`}
          >
            {paused ? <Play size={15} /> : <Pause size={15} />}
          </button>
        )}
        <button
          type="button"
          aria-label={getString("download_cancel")}
          onClick={() => void cancelDownload(progress.id)}
          className={`${CONTROL} hover:bg-chrome-red-950/70 hover:text-chrome-red-300`}
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
