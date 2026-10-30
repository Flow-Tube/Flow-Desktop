import type { Command, LiveDevice, LiveStatus, Now } from "../api/live";
import { positionOf } from "./position";

/** What a device should show after a command, until its next `now` says what it really does. */
export interface Override {
  now: Now;
  nowAtMs: number;
  /** When the `now` it was made from arrived; a later one replaces it. */
  since: number;
}

/** The state `cmd` should leave `device` in, or `null` when it changes nothing shown. */
export function overrideFor(
  device: LiveDevice,
  cmd: Command,
  value: { pos?: number; vol?: number },
  atMs: number,
): Override | null {
  const now = device.now;
  if (!now?.video) return null;
  const pos = positionOf(device, atMs);
  const next: Partial<Now> | null =
    cmd === "play"
      ? { state: "playing", pos }
      : cmd === "pause"
        ? { state: "paused", pos }
        : cmd === "seek" && value.pos !== undefined
          ? { pos: value.pos }
          : cmd === "volume" && value.vol !== undefined
            ? { pos, vol: value.vol }
            : null;
  return next && { now: { ...now, ...next }, nowAtMs: atMs, since: device.nowAtMs };
}

/** The status with each override still waiting for its device's next `now`, and those overrides. */
export function withOverrides(
  status: LiveStatus | null,
  overrides: Record<string, Override>,
): { status: LiveStatus | null; overrides: Record<string, Override> } {
  if (!status) return { status, overrides: {} };
  const waiting = Object.fromEntries(
    Object.entries(overrides).filter(([did, override]) => (status.devices[did]?.nowAtMs ?? 0) <= override.since),
  );
  const devices = { ...status.devices };
  for (const [did, override] of Object.entries(waiting)) {
    const device = devices[did];
    if (device) devices[did] = { ...device, now: override.now, nowAtMs: override.nowAtMs };
  }
  return { status: { ...status, devices }, overrides: waiting };
}

/** The device the user chose to control, while it stays online. */
export function stillControlled(status: LiveStatus | null, did: string | null): string | null {
  return did && status?.online.includes(did) ? did : null;
}
