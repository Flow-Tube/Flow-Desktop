import type { LiveDevice, LiveStatus } from "../api/live";

/** Where a device's video is now: its last `pos`, moved on by the time since, while it plays. */
export function positionOf(device: LiveDevice, nowMs: number): number {
  const now = device.now;
  if (!now) return 0;
  if (now.state !== "playing") return now.pos;
  const moved = now.pos + Math.max(0, nowMs - device.nowAtMs);
  return now.dur > 0 ? Math.min(moved, now.dur) : moved;
}

/** The device playing, from the latest `now` that says so (spec/live.md, Playing on another device). */
export function activeDevice(status: LiveStatus | null): string | null {
  let active: string | null = null;
  let latest = -1;
  for (const [did, device] of Object.entries(status?.devices ?? {})) {
    if (device.now?.state === "playing" && device.nowAtMs > latest) {
      active = did;
      latest = device.nowAtMs;
    }
  }
  return active;
}
