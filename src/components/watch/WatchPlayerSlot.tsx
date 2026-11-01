import { PictureInPicture2 } from "lucide-react";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { SETTINGS } from "../../lib/settings/schema";
import { requestPopoutReturn } from "../../lib/pipHandoff";
import { getString } from "../../lib/i18n/index";

export function WatchPlayerSlot() {
  const isTheaterMode = usePlayerStore((s) => s.isTheaterMode);
  const videoPlayerMode = usePlayerStore((s) => s.videoPlayerMode);
  const expandVideoPlayer = usePlayerStore((s) => s.expandVideoPlayer);
  const videoAspectRatio = usePlayerStore((s) => s.videoAspectRatio);
  const adaptivePlayerSize = useAppSettingsStore(
    (s) => s.values[SETTINGS.ADAPTIVE_PLAYER_SIZE_ENABLED] !== "false",
  );
  const isFloating = videoPlayerMode === "pip";
  const isPoppedOut = videoPlayerMode === "window";

  const effectiveRatio =
    !isTheaterMode && adaptivePlayerSize && videoAspectRatio
      ? Math.min(2.4, Math.max(1.2, videoAspectRatio))
      : 16 / 9;

  const overlayClass =
    "absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-[inherit] bg-chrome-black/85 text-sm font-medium text-chrome-zinc-300 transition-colors hover:text-chrome-white";

  return (
    <div
      data-flow-watch-player-slot="true"
      style={{ aspectRatio: `${effectiveRatio}` }}
      className={
        isTheaterMode
          ? "relative w-full max-h-[calc(100vh-160px)] min-h-[480px] bg-chrome-black"
          : "relative w-full max-h-[calc(100vh-160px)] overflow-hidden rounded-xl bg-chrome-black"
      }
    >
      {isFloating && (
        <button type="button" onClick={expandVideoPlayer} className={overlayClass}>
          <PictureInPicture2 className="h-7 w-7" />
          Playing in mini player — tap to expand
        </button>
      )}

      {/* The pop-out owns the position, so returning is a request to it rather
          than a local mode flip. */}
      {isPoppedOut && (
        <button type="button" onClick={() => void requestPopoutReturn()} className={overlayClass}>
          <PictureInPicture2 className="h-7 w-7" />
          {getString("watch_playing_in_popout")}
          <span className="text-xs text-chrome-zinc-400">
            {getString("watch_playing_in_popout_action")}
          </span>
        </button>
      )}
    </div>
  );
}
