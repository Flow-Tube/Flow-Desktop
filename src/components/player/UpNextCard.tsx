import { useImageProxyStore } from "../../store/useImageProxyStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { getPlural, getString } from "../../lib/i18n/index";
import { proxiedImage } from "../../lib/imageProxy";
import type { VideoSummary } from "../../types/video";

interface UpNextCardProps {
  video: VideoSummary;
  secondsLeft: number;
  onCancel: () => void;
  onRestart: () => void;
  onPlayNow: () => void;
}

const QUIET_BUTTON =
  "rounded-full px-3 py-1.5 text-xs font-semibold text-chrome-neutral-200 transition-colors hover:bg-chrome-white/10";
const MAIN_BUTTON =
  "rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary transition-transform active:scale-95";

/** Shown while the autoplay delay runs. The mini player has only room for the count and two actions. */
export function UpNextCard({ video, secondsLeft, onCancel, onRestart, onPlayNow }: UpNextCardProps) {
  const compact = usePlayerStore((s) => s.videoPlayerMode === "pip");
  const proxyBase = useImageProxyStore((s) => s.base);

  if (compact) {
    return (
      <div className="absolute inset-x-2 top-2 z-40 flex items-center justify-between gap-2 rounded-xl border border-chrome-toast-border bg-chrome-toast/95 px-2 py-1 text-chrome-neutral-100 shadow-2xl">
        <span className="truncate text-xs font-semibold tabular-nums">
          {getPlural("player_up_next_mini", secondsLeft)}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={onCancel} className={QUIET_BUTTON}>
            {getString("player_up_next_cancel")}
          </button>
          <button type="button" onClick={onPlayNow} className={MAIN_BUTTON}>
            {getString("player_up_next_play_now")}
          </button>
        </span>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="absolute bottom-20 right-3 z-40 w-[min(92%,360px)] rounded-xl border border-chrome-toast-border bg-chrome-toast/95 p-3 text-chrome-neutral-100 shadow-2xl sm:right-5"
    >
      <p className="mb-2 text-xs font-semibold tabular-nums text-chrome-neutral-400">
        {getPlural("player_up_next_in", secondsLeft)}
      </p>
      <div className="flex min-w-0 gap-3">
        {video.thumbnailUrl && (
          <img
            src={proxiedImage(video.thumbnailUrl, proxyBase)}
            alt=""
            className="aspect-video w-24 shrink-0 rounded-lg object-cover"
          />
        )}
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-medium">{video.title || getString("player_up_next")}</p>
          {video.channelName && <p dir="auto" className="truncate text-xs text-chrome-neutral-400">{video.channelName}</p>}
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-1">
        <button type="button" onClick={onCancel} className={QUIET_BUTTON}>
          {getString("player_up_next_cancel")}
        </button>
        <button type="button" onClick={onRestart} className={QUIET_BUTTON}>
          {getString("player_up_next_restart")}
        </button>
        <button type="button" onClick={onPlayNow} className={MAIN_BUTTON}>
          {getString("player_up_next_play_now")}
        </button>
      </div>
    </div>
  );
}
