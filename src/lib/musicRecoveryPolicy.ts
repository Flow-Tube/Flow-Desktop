/**
 * What the music player does when its audio element fails, ported from the
 * Android service's recovery rules: each track gets a few recoveries, the count
 * resets after two minutes of clean playback, and the kind of failure decides
 * the remedy.
 */

/** Android's RECOVERY_SUCCESS_GRACE_MS: clean playback this long forgives earlier failures. */
export const RECOVERY_SUCCESS_GRACE_MS = 2 * 60_000;

/** Fresh links tried for one track before the error is shown. Each one walks the client ladder. */
export const MAX_RECOVERIES_PER_TRACK = 3;

/**
 * - `offline`: the connection is gone; wait for it and carry on.
 * - `decode`: the element could not decode or does not support the format; try AAC.
 * - `link`: the link was refused, expired or stopped sending; fetch a fresh one.
 */
export type MediaFailure = "offline" | "decode" | "link";

// HTMLMediaElement's MediaError codes.
const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

/**
 * `code` is the element's `error.code`, or null for a stall with no error.
 * A link that answers with an error page also reads as "not supported", and a
 * fresh link is fetched for a decode retry anyway, so both cases are covered.
 */
export function classifyMediaFailure(code: number | null, online: boolean): MediaFailure {
  if (!online) return "offline";
  if (code === MEDIA_ERR_DECODE || code === MEDIA_ERR_SRC_NOT_SUPPORTED) return "decode";
  return "link";
}

/** The `ErrorResponse.kind` each failure is shown as once recovery gives up. */
export const MEDIA_FAILURE_KIND: Record<MediaFailure, string> = {
  offline: "network",
  decode: "mediaDecode",
  link: "streamExpired",
};

export type RecoveryDecision = "waitForNetwork" | "retry" | "giveUp";

interface TrackRecord {
  attempts: number;
  lastFailureAt: number;
  preferAac: boolean;
  /** Audio has played since the switch to AAC, so AAC decodes here. */
  aacPlayed: boolean;
}

export class RecoveryLedger {
  private readonly tracks = new Map<string, TrackRecord>();

  /** Decides what to do about `failure` on `videoId`, counting the attempt it allows. */
  decide(videoId: string, failure: MediaFailure, now: number): RecoveryDecision {
    // A lost connection is not the link's fault, so waiting for it costs no attempt.
    if (failure === "offline") return "waitForNetwork";
    const record = this.tracks.get(videoId) ?? { attempts: 0, lastFailureAt: now, preferAac: false, aacPlayed: false };
    if (failure === "decode" && record.preferAac) {
      // AAC never played either, so no format left would. One that did play
      // and fails later has a dead link, which a fresh one fixes.
      if (!record.aacPlayed) return "giveUp";
    } else if (failure === "decode") {
      record.preferAac = true;
    }
    if (record.attempts >= MAX_RECOVERIES_PER_TRACK) return "giveUp";
    record.attempts += 1;
    record.lastFailureAt = now;
    this.tracks.set(videoId, record);
    return "retry";
  }

  /** Clean playback long enough after the last failure forgives the earlier attempts. */
  notePlaying(videoId: string, now: number): void {
    const record = this.tracks.get(videoId);
    if (!record) return;
    if (record.preferAac) record.aacPlayed = true;
    if (now - record.lastFailureAt > RECOVERY_SUCCESS_GRACE_MS) record.attempts = 0;
  }

  /** Whether the track's next lookup should ask for AAC. */
  prefersAac(videoId: string): boolean {
    return this.tracks.get(videoId)?.preferAac ?? false;
  }

  /** The user asked for a retry: start the count again. */
  forgive(videoId: string): void {
    const record = this.tracks.get(videoId);
    if (record) record.attempts = 0;
  }
}
