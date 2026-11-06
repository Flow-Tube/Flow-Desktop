import { Check, Loader2, Pause, Play, Trash2, WifiOff, X } from "lucide-react";

import {
  cancelDownload,
  pauseDownload,
  resumeDownload,
  type DownloadProgress,
} from "../../lib/api/downloads";
import { getString } from "../../lib/i18n/index";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import type { VideoSummary } from "../../types/video";

function formatDuration(seconds?: number | null): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

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

interface DownloadVideoCardProps {
  video: VideoSummary;
  progress?: DownloadProgress;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onPlay?: (video: VideoSummary) => void;
  onDelete?: () => void;
  /** A finished download's size and date. */
  detail?: string;
}

export function DownloadVideoCard({
  video,
  progress,
  selectable = false,
  selected = false,
  onToggleSelect,
  onPlay,
  onDelete,
  detail,
}: DownloadVideoCardProps) {
  const thumbnail = useProxiedImageUrl(video.thumbnailUrl);
  const downloading = Boolean(progress);
  const percent = progress ? progressPercent(progress) : null;
  const paused = progress?.status === "paused";
  const waiting = progress?.status === "waitingForNetwork";

  const activate = () => {
    if (selectable) onToggleSelect?.();
    else if (!downloading) onPlay?.(video);
  };

  return (
    <div className="group flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        onClick={activate}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") activate();
        }}
        className={`relative aspect-video w-full cursor-pointer overflow-hidden rounded-xl border bg-surface-container ${
          selected ? "border-[var(--color-primary)]" : "border-transparent"
        }`}
      >
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={video.title}
            loading="lazy"
            className={`h-full w-full object-cover transition-transform duration-300 ${
              downloading ? "scale-100 opacity-60" : "group-hover:scale-[1.03]"
            }`}
          />
        ) : (
          <div className="h-full w-full bg-surface-container-high" />
        )}

        {downloading ? (
          <div className="absolute inset-0 flex flex-col justify-end bg-chrome-black/40 p-3">
            <div className="flex items-center gap-2">
              <span className="text-chrome-neutral-100">
                {waiting ? (
                  <WifiOff className="h-4 w-4" />
                ) : paused ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-chrome-neutral-100">
                {statusLabel(progress!)}
                {percent != null ? ` · ${Math.round(percent)}%` : ""}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-chrome-white/25">
              <div
                className={`h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-200 ${percent == null ? "w-1/3 animate-pulse" : ""}`}
                style={percent == null ? undefined : { width: `${percent}%` }}
              />
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              {progress!.status !== "muxing" ? (
                <button
                  type="button"
                  aria-label={paused ? getString("download_resume") : getString("download_pause")}
                  onClick={(event) => {
                    event.stopPropagation();
                    void (paused ? resumeDownload(progress!.id) : pauseDownload(progress!.id));
                  }}
                  className="grid h-8 w-8 place-items-center rounded-full bg-chrome-black/50 text-chrome-neutral-100 transition-colors hover:bg-chrome-black/70"
                >
                  {paused ? <Play size={15} /> : <Pause size={15} />}
                </button>
              ) : null}
              <button
                type="button"
                aria-label={getString("download_cancel")}
                onClick={(event) => {
                  event.stopPropagation();
                  void cancelDownload(progress!.id);
                }}
                className="grid h-8 w-8 place-items-center rounded-full bg-chrome-black/50 text-chrome-neutral-100 transition-colors hover:bg-chrome-red-950/70 hover:text-chrome-red-300"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        ) : (
          <>
            {video.durationSeconds ? (
              <div className="absolute bottom-1 right-1 z-10 rounded bg-chrome-black/80 px-1 py-px text-[12px] font-medium leading-tight tracking-wide text-chrome-white">
                {formatDuration(video.durationSeconds)}
              </div>
            ) : null}
            {!selectable && onDelete ? (
              <button
                type="button"
                aria-label={getString("downloads_remove")}
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
                className="absolute right-2 top-2 z-20 grid h-8 w-8 place-items-center rounded-full border border-chrome-white/15 bg-chrome-black/80 text-chrome-white opacity-0 transition-colors duration-200 ease-out hover:bg-chrome-red-950/50 hover:text-chrome-red-300 group-hover:opacity-100"
              >
                <Trash2 size={15} />
              </button>
            ) : null}
          </>
        )}

        {selectable ? (
          <div
            className={`absolute left-2 top-2 z-20 grid h-6 w-6 place-items-center rounded-full border transition-colors ${
              selected
                ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                : "border-chrome-white/70 bg-chrome-black/40 text-transparent"
            }`}
          >
            <Check size={14} />
          </div>
        ) : null}
      </div>

      <div className="min-w-0">
        <h3
          onClick={activate}
          className="cursor-pointer text-sm font-medium leading-snug text-chrome-neutral-100 transition-colors hover:text-chrome-white line-clamp-2"
        >
          {video.title}
        </h3>
        {video.channelName ? (
          <div className="mt-0.5 truncate text-[13px] text-chrome-neutral-400">{video.channelName}</div>
        ) : null}
        {detail ? <div className="mt-0.5 truncate text-xs tabular-nums text-chrome-neutral-500">{detail}</div> : null}
      </div>
    </div>
  );
}
