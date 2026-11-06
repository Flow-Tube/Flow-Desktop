import { ChevronRight, MonitorSmartphone } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { getString } from "../../lib/i18n/index";
import type { DeviceGroup, PlayOnDevice } from "../../lib/live/devices";
import { usePlayOn } from "../../lib/live/usePlayOn";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { useUiStore } from "../../store/useUiStore";
import { usePlayOnStore } from "../../store/usePlayOnStore";
import { DeviceRow } from "./DeviceRow";
import { NowPlayingCard } from "./NowPlayingCard";

const GROUPS: Array<[DeviceGroup, "play_on_playing_now" | "play_on_available" | "play_on_offline"]> = [
  ["playing", "play_on_playing_now"],
  ["available", "play_on_available"],
  ["offline", "play_on_offline"],
];

/** "Play on": what plays, and the group's devices to move it to. */
export function PlayOnPopover({ onClose }: { onClose: () => void }) {
  const { devices, active } = usePlayOn();
  const pickDevice = usePlayOnStore((state) => state.pick);
  const movingTo = usePlayOnStore((state) => state.movingTo);
  const navigate = useNavigate();
  const showToast = useUiStore((state) => state.showToast);

  const pick = (device: PlayOnDevice) => {
    pickDevice(device).catch((error: unknown) =>
      showToast({
        variant: "error",
        message: getString("play_on_failed", device.thisDevice ? getString("play_on_this_device") : device.name, String(error instanceof Error ? error.message : error)),
      }),
    );
  };

  const manage = () => {
    onClose();
    // The full player would otherwise stay over the page it opens.
    useMusicPlayerStore.getState().closeOverlay();
    navigate("/sync");
  };

  return (
    <div
      role="dialog"
      aria-labelledby="play-on-title"
      className="flex max-h-[70vh] w-[360px] flex-col gap-4 overflow-y-auto rounded-2xl border border-chrome-neutral-800 bg-surface-container p-4"
    >
      <div>
        <h2 id="play-on-title" className="text-base font-medium text-chrome-neutral-200">
          {getString("play_on_title")}
        </h2>
        <p className="text-sm text-chrome-neutral-400">{getString("play_on_subtitle")}</p>
      </div>
      {active && <NowPlayingCard device={active} nowMs={Date.now()} />}
      {GROUPS.map(([group, label]) => {
        const listed = devices.filter((device) => device.group === group);
        if (listed.length === 0) return null;
        return (
          <section key={group} className="flex flex-col gap-1">
            <h3 className="px-2 text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">{getString(label)}</h3>
            {listed.map((device) => (
              <DeviceRow
                key={device.did}
                device={device}
                active={device.did === active?.did}
                moving={device.did === movingTo}
                disabled={movingTo !== null || device.group === "offline" || (device.thisDevice && device.did === active?.did)}
                onPick={() => pick(device)}
              />
            ))}
          </section>
        );
      })}
      <button
        type="button"
        onClick={manage}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-start transition-colors duration-200 ease-out hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-container-high text-chrome-neutral-300">
          <MonitorSmartphone className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-1 text-sm font-medium text-chrome-neutral-100">{getString("play_on_manage")}</span>
          <span className="line-clamp-1 text-xs text-chrome-neutral-400">{getString("play_on_manage_summary")}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-chrome-neutral-500" />
      </button>
    </div>
  );
}
