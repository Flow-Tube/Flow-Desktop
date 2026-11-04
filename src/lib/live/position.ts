import type { LiveDevice, LiveStatus } from "../api/live";
import { playingNow, reachable } from "./freshness";

/** Where a device's video is now: its last `pos`, moved on by the time since, while it plays. */
export function positionOf(device: Pick<LiveDevice, "now" | "nowAtMs">, nowMs: number): number {
  const now = device.now;
  if (!now) return 0;
  if (!playingNow(device, nowMs)) return now.pos;
  const moved = now.pos + Math.max(0, nowMs - device.nowAtMs);
  return now.dur > 0 ? Math.min(moved, now.dur) : moved;
}

/**
 * The reachable device that last told of a session, playing or paused: the one a pull or a move
 * takes from when no device is chosen (spec/live.md, Playing on another device).
 */
export function currentDevice(status: LiveStatus | null, nowMs: number): string | null {
  let current: string | null = null;
  let latest = -1;
  for (const [did, device] of Object.entries(status?.devices ?? {})) {
    if (device.now?.video && reachable(status, did, nowMs) && device.nowAtMs > latest) {
      current = did;
      latest = device.nowAtMs;
    }
  }
  return current;
}

/** The device the user chose, while it can be reached with a session, else the current one. */
export function controlledDevice(status: LiveStatus | null, chosen: string | null, nowMs: number): string | null {
  if (chosen && status?.devices[chosen]?.now?.video && reachable(status, chosen, nowMs)) return chosen;
  return currentDevice(status, nowMs);
}
