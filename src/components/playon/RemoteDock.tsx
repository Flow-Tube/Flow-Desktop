import { getString } from "../../lib/i18n/index";
import { useControlledDevice, useRemoteActive } from "../../lib/live/usePlayOn";
import { youtubeThumbnailUrl } from "../../lib/thumbnails";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { usePlayOnStore } from "../../store/usePlayOnStore";
import { GHOST_IDLE } from "../music/GlobalMusicDock";
import { TransportButtons } from "../music/player/PlayerTransport";
import { DeviceKindIcon } from "./DeviceKindIcon";
import { PlayOnButton } from "./PlayOnButton";
import { RemoteProgress } from "./RemoteProgress";

/** The player bar for a video another device plays while this one controls it; music uses the music dock. */
export function RemoteDock() {
  const remote = useRemoteActive();
  const device = useControlledDevice();
  const drive = usePlayOnStore((state) => state.drive);
  const art = useProxiedImageUrl(device ? youtubeThumbnailUrl(device.now.video) : null);
  if (!remote || !device || device.did !== remote || device.now.music) return null;
  const { now } = device;

  return (
    <div className="fixed bottom-6 left-1/2 z-50 h-[72px] w-[90%] max-w-5xl -translate-x-1/2">
      <div className="relative flex h-full items-center overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface-container-high pl-3 pr-4">
        <div className="flex w-1/3 min-w-0 items-center gap-3">
          {art && <img src={art} alt="" className="aspect-video h-12 shrink-0 rounded-xl object-cover" />}
          <div className="min-w-0">
            <div className="line-clamp-1 text-[15px] font-semibold tracking-tight text-chrome-neutral-100">{now.title}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-primary)]">
              <DeviceKindIcon kind={device.kind} className="h-3.5 w-3.5 shrink-0" />
              <span className="line-clamp-1">{getString("play_on_on_device", device.name)}</span>
            </div>
          </div>
        </div>
        <div className="flex w-1/3 items-center justify-center">
          <TransportButtons
            size="sm"
            playing={now.state === "playing"}
            onPrevious={() => void drive(remote, "previous")}
            onTogglePlay={() => void drive(remote, now.state === "playing" ? "pause" : "play")}
            onNext={() => void drive(remote, "next")}
          />
        </div>
        <div className="flex w-1/3 items-center justify-end">
          <PlayOnButton className={GHOST_IDLE} />
        </div>
        <RemoteProgress device={device} />
      </div>
    </div>
  );
}
