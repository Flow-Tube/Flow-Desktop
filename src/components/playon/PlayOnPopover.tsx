import { getString } from "../../lib/i18n/index";
import type { DeviceGroup, PlayOnDevice } from "../../lib/live/devices";
import { usePlayOn } from "../../lib/live/usePlayOn";
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
export function PlayOnPopover() {
  const { devices, active } = usePlayOn();
  const moveTo = usePlayOnStore((state) => state.moveTo);
  const pullFrom = usePlayOnStore((state) => state.pullFrom);
  const control = usePlayOnStore((state) => state.control);
  const showToast = useUiStore((state) => state.showToast);

  /** Here: pull playback back. A device playing: control it. Any other: move playback there. */
  const pick = (device: PlayOnDevice) => {
    if (!device.thisDevice && device.group === "playing") {
      control(device.did);
      return;
    }
    const moving = device.thisDevice ? (active ? pullFrom(active.did) : Promise.resolve()) : moveTo(device.did);
    moving.catch((error: unknown) =>
      showToast({
        variant: "error",
        message: getString("play_on_failed", device.thisDevice ? getString("play_on_this_device") : device.name, String(error instanceof Error ? error.message : error)),
      }),
    );
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
                disabled={device.group === "offline" || (device.thisDevice && device.did === active?.did)}
                onPick={() => pick(device)}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}
