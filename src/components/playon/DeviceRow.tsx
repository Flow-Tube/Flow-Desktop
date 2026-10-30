import { Check } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import type { PlayOnDevice } from "../../lib/live/devices";
import { formatYouTubeRelativeTime } from "../../lib/publishedDate";
import { PlayingWave } from "../music/PlayingWave";
import { DeviceKindIcon } from "./DeviceKindIcon";

function detail(device: PlayOnDevice): string {
  if (device.group === "offline") {
    return device.lastSeenMs ? getString("play_on_last_seen", formatYouTubeRelativeTime(device.lastSeenMs)) : getString("play_on_offline");
  }
  if (device.group === "playing") return device.now?.title ?? "";
  return device.now?.title ? getString("play_on_paused", device.now.title) : getString("play_on_ready");
}

/** A device to play on: tapping it moves playback there. */
export function DeviceRow({ device, active, onPick }: { device: PlayOnDevice; active: boolean; onPick: () => void }) {
  const offline = device.group === "offline";
  return (
    <button
      type="button"
      disabled={offline || active}
      onClick={onPick}
      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors duration-200 ease-out enabled:hover:bg-surface-container-high disabled:cursor-default"
    >
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-container-high ${
          active ? "text-[var(--color-primary)]" : offline ? "text-chrome-neutral-600" : "text-chrome-neutral-300"
        }`}
      >
        <DeviceKindIcon kind={device.kind} className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`line-clamp-1 text-sm font-medium ${offline ? "text-chrome-neutral-500" : "text-chrome-neutral-100"}`}>
          {device.thisDevice ? getString("play_on_this_device") : device.name}
        </span>
        <span className="line-clamp-1 text-xs text-chrome-neutral-400">{detail(device)}</span>
      </span>
      {device.group === "playing" && <PlayingWave className="h-4 text-[var(--color-primary)]" />}
      {active && <Check className="h-4 w-4 shrink-0 text-[var(--color-primary)]" aria-label={getString("play_on_active")} />}
    </button>
  );
}
