import { PictureInPicture2 } from "lucide-react";
import { usePlayerStore } from "../../store/usePlayerStore";
import { requestPopoutReturn } from "../../lib/pipHandoff";
import { getString } from "../../lib/i18n/index";

export function WatchPlayerSlot() {
  const isTheaterMode = usePlayerStore((s) => s.isTheaterMode);
  const videoPlayerMode = usePlayerStore((s) => s.videoPlayerMode);
  const expandVideoPlayer = usePlayerStore((s) => s.expandVideoPlayer);
  const isFloating = videoPlayerMode === "pip";
  const isPoppedOut = videoPlayerMode === "window";

  const overlayClass =
    "absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-[inherit] bg-chrome-black/85 text-sm font-medium text-chrome-zinc-300 transition-colors hover:text-chrome-white";

  return (
    <div
      data-flow-watch-player-slot="true"
      className={
        isTheaterMode
          ? "relative w-full aspect-video max-h-[calc(100vh-160px)] min-h-[480px] bg-chrome-black"
          : "relative w-full aspect-video overflow-hidden rounded-xl bg-chrome-black"
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
