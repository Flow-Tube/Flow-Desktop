import { Pause, Play, SkipBack, SkipForward } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import { positionOf } from "../../lib/live/position";
import { usePlayOn, useRemoteActive } from "../../lib/live/usePlayOn";
import { youtubeThumbnailUrl } from "../../lib/thumbnails";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { usePlayOnStore } from "../../store/usePlayOnStore";
import { DeviceKindIcon } from "./DeviceKindIcon";
import { PlayOnButton } from "./PlayOnButton";

const CONTROL =
  "grid h-9 w-9 place-items-center rounded-full text-chrome-neutral-200 transition-colors duration-200 ease-out hover:text-chrome-neutral-100";

/** The player bar while another device plays and nothing plays here: its controls drive that device. */
export function RemoteDock() {
  const remote = useRemoteActive();
  const { active } = usePlayOn();
  const drive = usePlayOnStore((state) => state.drive);
  const now = active?.now;
  const art = useProxiedImageUrl(now?.video ? youtubeThumbnailUrl(now.video) : null);
  if (!remote || !active || active.did !== remote || !now?.video) return null;
  const fraction = now.dur > 0 ? Math.min(1, positionOf(active, Date.now()) / now.dur) : 0;

  return (
    <div className="fixed bottom-6 left-1/2 z-50 h-[72px] w-[90%] max-w-5xl -translate-x-1/2">
      <div className="relative flex h-full items-center overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface-container-high pl-3 pr-4">
        <div className="flex w-1/3 min-w-0 items-center gap-3">
          {art && <img src={art} alt="" className={`shrink-0 rounded-xl object-cover ${now.music ? "h-12 w-12" : "aspect-video h-12"}`} />}
          <div className="min-w-0">
            <div className="line-clamp-1 text-[15px] font-semibold tracking-tight text-chrome-neutral-100">{now.title}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-primary)]">
              <DeviceKindIcon kind={active.kind} className="h-3.5 w-3.5 shrink-0" />
              <span className="line-clamp-1">{getString("play_on_playing_on", active.name)}</span>
            </div>
          </div>
        </div>
        <div className="flex w-1/3 items-center justify-center gap-5">
          <button type="button" className={CONTROL} aria-label={getString("music_previous")} onClick={() => void drive(remote, "previous")}>
            <SkipBack className="h-5 w-5" fill="currentColor" />
          </button>
          <button
            type="button"
            aria-label={getString(now.state === "playing" ? "music_pause" : "music_play")}
            onClick={() => void drive(remote, now.state === "playing" ? "pause" : "play")}
            className="grid h-11 w-11 place-items-center rounded-full bg-[var(--color-primary)] text-[var(--color-on-primary)]"
          >
            {now.state === "playing" ? <Pause className="h-7 w-7" fill="currentColor" /> : <Play className="h-7 w-7 translate-x-px" fill="currentColor" />}
          </button>
          <button type="button" className={CONTROL} aria-label={getString("music_next")} onClick={() => void drive(remote, "next")}>
            <SkipForward className="h-5 w-5" fill="currentColor" />
          </button>
        </div>
        <div className="flex w-1/3 items-center justify-end">
          <PlayOnButton className="grid h-9 w-9 place-items-center rounded-full transition-colors duration-200 ease-out text-chrome-neutral-400 hover:text-chrome-neutral-100" />
        </div>
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-surface-container-highest">
          <span className="block h-full bg-[var(--color-primary)]" style={{ width: `${fraction * 100}%` }} />
        </span>
      </div>
    </div>
  );
}
