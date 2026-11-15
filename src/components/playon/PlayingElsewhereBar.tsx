import { useState } from "react";
import { X } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import { usePlayingElsewhere } from "../../lib/live/usePlayingElsewhere";
import { youtubeThumbnailUrl } from "../../lib/thumbnails";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { usePlayOnStore } from "../../store/usePlayOnStore";
import { useUiStore } from "../../store/useUiStore";
import { Button } from "../ui/Button";
import { GHOST_IDLE } from "../music/dock/dockStyles";
import { DeviceKindIcon } from "./DeviceKindIcon";
import { RemoteProgress } from "./RemoteProgress";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/**
 * Where the player bar rests while this device plays nothing: another device playing on its own,
 * with Play here and close. Clicking what it plays starts controlling that device.
 */
export function PlayingElsewhereBar() {
  const device = usePlayingElsewhere();
  const control = usePlayOnStore((state) => state.control);
  const pullFrom = usePlayOnStore((state) => state.pullFrom);
  const closeHint = usePlayOnStore((state) => state.closeHint);
  const movingTo = usePlayOnStore((state) => state.movingTo);
  const [pulling, setPulling] = useState(false);
  const art = useProxiedImageUrl(device ? youtubeThumbnailUrl(device.now.video) : null);
  if (!device) return null;
  const name = device.name || getString("play_on_another_device");

  const playHere = () => {
    setPulling(true);
    pullFrom(device.did)
      .catch((error: unknown) =>
        useUiStore.getState().showToast({
          variant: "error",
          message: getString("play_on_failed", getString("play_on_this_device"), String(error instanceof Error ? error.message : error)),
        }),
      )
      .finally(() => setPulling(false));
  };

  return (
    <div className="fixed bottom-6 left-1/2 z-50 h-[72px] w-[90%] max-w-5xl -translate-x-1/2">
      <div className="relative flex h-full items-center gap-3 overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface-container-high ps-3 pe-4">
        <button
          type="button"
          onClick={() => control(device.did)}
          aria-label={getString("play_on_control_device", name)}
          className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl py-2 text-start transition-colors duration-200 ease-out hover:bg-surface-container-highest ${FOCUS}`}
        >
          {art && <img src={art} alt="" className="aspect-video h-12 shrink-0 rounded-xl object-cover" />}
          <span className="min-w-0">
            <span dir="auto" className="line-clamp-1 text-[15px] font-semibold tracking-tight text-chrome-neutral-100">
              {device.now.title}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-primary)]">
              <DeviceKindIcon kind={device.kind} className="h-3.5 w-3.5 shrink-0" />
              <span className="line-clamp-1">{getString("play_on_playing_on", name)}</span>
            </span>
          </span>
        </button>
        <Button variant="tonal" size="sm" disabled={pulling || movingTo !== null} onClick={playHere} className={FOCUS}>
          {getString("play_on_play_here")}
        </Button>
        <button
          type="button"
          onClick={() => closeHint(device.did, device.now.video)}
          aria-label={getString("close")}
          className={`${GHOST_IDLE} ${FOCUS}`}
        >
          <X className="h-4 w-4" />
        </button>
        <RemoteProgress device={device} />
      </div>
    </div>
  );
}
