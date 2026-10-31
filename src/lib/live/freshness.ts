import type { LiveDevice, LiveStatus } from "../api/live";

/** A device heard from this recently counts as reachable, as on Android. */
export const HEARD_WITHIN_MS = 90_000;
/** Devices repeat a playing `now` every 30 s; one this old missed two and no longer counts as playing. */
export const PLAYING_WITHIN_MS = 75_000;

/** Whether `did` can be reached: the server or the LAN lists it, or it spoke lately. */
export function reachable(status: LiveStatus | null, did: string, nowMs: number): boolean {
  if (status?.online.includes(did)) return true;
  const heard = status?.devices[did]?.heardAtMs ?? 0;
  return heard > 0 && nowMs - heard < HEARD_WITHIN_MS;
}

/** Whether the device's latest `now` says it plays and is recent enough to believe. */
export function playingNow(device: Pick<LiveDevice, "now" | "nowAtMs"> | undefined, nowMs: number): boolean {
  return Boolean(device?.now?.video) && device?.now?.state === "playing" && nowMs - (device?.nowAtMs ?? 0) < PLAYING_WITHIN_MS;
}
