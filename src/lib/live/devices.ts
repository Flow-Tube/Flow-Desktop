import type { LinkedDevice } from "../api/linked";
import type { DeviceKind, LiveStatus, Now } from "../api/live";
import { playingNow, reachable as reachableNow } from "./freshness";

export type DeviceGroup = "playing" | "available" | "offline";

/** A device of the group as "Play on" lists it. */
export interface PlayOnDevice {
  did: string;
  name: string;
  kind: DeviceKind;
  thisDevice: boolean;
  group: DeviceGroup;
  /** What it plays or has paused; `null` when nothing is loaded. */
  now: Now | null;
  nowAtMs: number;
  lastSeenMs: number | null;
}

const ORDER: Record<DeviceGroup, number> = { playing: 0, available: 1, offline: 2 };

function kindOf(platform: string): DeviceKind {
  return platform === "android" || platform === "ios" ? "phone" : "desktop";
}

/**
 * The group's devices for "Play on": this one, from what it plays (`here`), and the others from
 * the live channel. A device the live channel and the LAN can't reach, and that hasn't spoken
 * lately, is offline; one whose last playing `now` is too old no longer counts as playing.
 */
export function playOnDevices(
  status: LiveStatus | null,
  linked: LinkedDevice[],
  here: Now,
  nowMs: number,
): PlayOnDevice[] {
  return linked
    .map((device): PlayOnDevice => {
      if (device.thisDevice) {
        return {
          did: device.id,
          name: device.name,
          kind: "desktop",
          thisDevice: true,
          group: here.video && here.state === "playing" ? "playing" : "available",
          now: here.video ? here : null,
          nowAtMs: nowMs,
          lastSeenMs: null,
        };
      }
      const live = status?.devices[device.id];
      const reachable = reachableNow(status, device.id, nowMs);
      return {
        did: device.id,
        name: device.name,
        kind: live?.kind ?? kindOf(device.platform),
        thisDevice: false,
        group: !reachable ? "offline" : playingNow(live, nowMs) ? "playing" : "available",
        now: reachable ? (live?.now ?? null) : null,
        nowAtMs: live?.nowAtMs ?? 0,
        lastSeenMs: device.lastSyncMs ?? null,
      };
    })
    .sort((a, b) => ORDER[a.group] - ORDER[b.group] || Number(b.thisDevice) - Number(a.thisDevice));
}

/** The device playing, by the latest `now` that says so; this one when it plays. */
export function activeOf(devices: PlayOnDevice[]): PlayOnDevice | null {
  return devices
    .filter((device) => device.group === "playing")
    .reduce<PlayOnDevice | null>((latest, device) => (!latest || device.nowAtMs > latest.nowAtMs ? device : latest), null);
}
