import { useEffect, useState } from "react";
import { Pause, Play, SkipBack, SkipForward, Volume2 } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import type { PlayOnDevice } from "../../lib/live/devices";
import { positionOf } from "../../lib/live/position";
import { formatTime } from "../../lib/musicFormat";
import { youtubeThumbnailUrl } from "../../lib/thumbnails";
import { useDebounce } from "../../lib/useDebounce";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { usePlayOnStore } from "../../store/usePlayOnStore";
import { Slider } from "../ui/Slider";
import { DeviceKindIcon } from "./DeviceKindIcon";

const CONTROL =
  "grid h-9 w-9 place-items-center rounded-full text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-surface-container-highest hover:text-chrome-neutral-100";

/** What the active device plays, with controls that drive it, here or elsewhere. */
export function NowPlayingCard({ device, nowMs }: { device: PlayOnDevice; nowMs: number }) {
  const drive = usePlayOnStore((state) => state.drive);
  const now = device.now;
  const target = device.thisDevice ? null : device.did;
  const art = useProxiedImageUrl(now?.video ? youtubeThumbnailUrl(now.video) : null);
  const [volume, setVolume] = useState(now?.vol ?? 0);
  const settled = useDebounce(volume, 250);

  // Runs only when the user's pick settles, not when `now` reports the volume back.
  useEffect(() => {
    if (now && settled !== now.vol) void drive(target, "volume", { vol: settled });
  }, [settled]);

  if (!now?.video) return null;
  const playingHere = now.state === "playing";
  const position = positionOf(device, nowMs);
  const fraction = now.dur > 0 ? Math.min(1, position / now.dur) : 0;
  const seekTo = (event: React.MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const pos = Math.round(((event.clientX - box.left) / box.width) * now.dur);
    void drive(target, "seek", { pos });
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-3">
      <div className="flex items-center gap-3">
        {art && (
          <img
            src={art}
            alt=""
            className={`shrink-0 rounded-xl object-cover ${now.music ? "h-14 w-14" : "aspect-video h-14"}`}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="line-clamp-1 text-sm font-medium text-chrome-neutral-100">{now.title}</div>
          <div className="line-clamp-1 text-xs text-chrome-neutral-400">{now.by}</div>
          <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-2 py-0.5 text-xs text-chrome-neutral-300">
            <DeviceKindIcon kind={device.kind} className="h-3.5 w-3.5" />
            {device.thisDevice ? getString("play_on_this_device") : device.name}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={seekTo}
          aria-label={getString("play_on_seek")}
          className="group relative h-1.5 w-full rounded-full bg-surface-container-highest"
        >
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-primary)]"
            style={{ width: `${fraction * 100}%` }}
          />
        </button>
        <div className="flex justify-between font-mono text-xs text-chrome-neutral-400">
          <span>{formatTime(position / 1000)}</span>
          <span>{formatTime(now.dur / 1000)}</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button type="button" className={CONTROL} aria-label={getString("music_previous")} onClick={() => void drive(target, "previous")}>
            <SkipBack className="h-4 w-4" fill="currentColor" />
          </button>
          <button
            type="button"
            aria-label={getString(playingHere ? "music_pause" : "music_play")}
            onClick={() => void drive(target, playingHere ? "pause" : "play")}
            className="grid h-10 w-10 place-items-center rounded-full bg-[var(--color-primary)] text-[var(--color-on-primary)] transition-colors duration-200 ease-out"
          >
            {playingHere ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="h-5 w-5 translate-x-px" fill="currentColor" />}
          </button>
          <button type="button" className={CONTROL} aria-label={getString("music_next")} onClick={() => void drive(target, "next")}>
            <SkipForward className="h-4 w-4" fill="currentColor" />
          </button>
        </div>
        <label className="flex min-w-0 flex-1 items-center gap-2 text-chrome-neutral-400">
          <Volume2 className="h-4 w-4 shrink-0" aria-hidden />
          <Slider value={volume} min={0} max={100} onChange={setVolume} aria-label={getString("music_volume")} className="flex-1" />
        </label>
      </div>
    </div>
  );
}
