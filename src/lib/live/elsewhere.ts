import type { LiveStatus, Now } from "../api/live";
import { PLAYING_WITHIN_MS } from "./freshness";

/** Another device playing on its own, as the player bar offers it, until `expiresAtMs` unless it tells more. */
export interface PlayingElsewhere {
  did: string;
  now: Now & { video: string };
  nowAtMs: number;
  expiresAtMs: number;
}

/** Each device whose hint the user closed, with the video it played then. */
export type ClosedHints = Record<string, string | null>;

/**
 * The device to offer as playing elsewhere at `atMs`: none while the user drives a device
 * (`controlling`), else the one whose fresh playing `now` arrived last, leaving out each device
 * whose hint the user closed for the video it still plays.
 */
export function findPlayingElsewhere(
  status: LiveStatus | null,
  controlling: string | null,
  closed: ClosedHints,
  atMs: number,
): PlayingElsewhere | null {
  if (controlling || !status) return null;
  let found: PlayingElsewhere | null = null;
  for (const [did, device] of Object.entries(status.devices)) {
    const now = device.now;
    if (!now?.video || now.state !== "playing") continue;
    if (atMs >= device.nowAtMs + PLAYING_WITHIN_MS) continue;
    if (did in closed && closed[did] === now.video) continue;
    if (found && found.nowAtMs >= device.nowAtMs) continue;
    found = { did, now: { ...now, video: now.video }, nowAtMs: device.nowAtMs, expiresAtMs: device.nowAtMs + PLAYING_WITHIN_MS };
  }
  return found;
}

/** `closed` with `video` on `did` closed, replacing the video closed on that device before. */
export function withClosedHint(closed: ClosedHints, did: string, video: string | null): ClosedHints {
  return { ...closed, [did]: video };
}
