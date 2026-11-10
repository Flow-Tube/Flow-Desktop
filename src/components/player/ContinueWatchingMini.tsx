import { Maximize2, Play, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getString } from "../../lib/i18n/index";
import { useContinueWatchingOnLaunch } from "../../lib/useContinueWatchingOnLaunch";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { usePlayerStore } from "../../store/usePlayerStore";

const ICON_BUTTON =
  "grid h-8 w-8 shrink-0 place-items-center rounded-full text-chrome-neutral-300 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100";

/** The last unfinished video, offered as a card where the mini player would be. */
export function ContinueWatchingMini() {
  const navigate = useNavigate();
  const { video, dismiss } = useContinueWatchingOnLaunch();
  const thumbnail = useProxiedImageUrl(video?.thumbnailUrl ?? null);
  if (!video) return null;

  const playInMiniPlayer = () => {
    const player = usePlayerStore.getState();
    player.setQueue([video], 0);
    player.enterVideoPip("manual");
  };
  const openWatchPage = () => {
    usePlayerStore.getState().setQueue([video], 0);
    navigate(`/watch/${video.id}`);
  };

  return (
    <div className="fixed bottom-6 end-6 z-40 flex w-[min(360px,calc(100vw-32px))] items-center gap-3 rounded-xl border border-outline-variant bg-surface-container p-2">
      <button type="button" onClick={playInMiniPlayer} className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-chrome-black">
        {thumbnail && <img src={thumbnail} alt="" className="h-full w-full object-cover" />}
        <span className="absolute inset-0 grid place-items-center bg-chrome-black/30 text-chrome-white">
          <Play size={20} fill="currentColor" />
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-chrome-neutral-500">{getString("player_continue_watching_label")}</p>
        <p dir="auto" className="truncate text-sm font-medium text-chrome-neutral-100">{video.title}</p>
        {video.viewCountText && <p className="truncate text-xs tabular-nums text-chrome-neutral-400">{video.viewCountText}</p>}
      </div>
      <button type="button" aria-label={getString("player_continue_watching_open")} title={getString("player_continue_watching_open")} onClick={openWatchPage} className={ICON_BUTTON}>
        <Maximize2 size={16} />
      </button>
      <button type="button" aria-label={getString("close")} title={getString("close")} onClick={dismiss} className={ICON_BUTTON}>
        <X size={16} />
      </button>
    </div>
  );
}
