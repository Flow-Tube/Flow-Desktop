/** Unplayable tracks skipped in a row before playback stops and says why. */
export const MAX_UNPLAYABLE_SKIPS = 3;

// Refusals about the track itself; the next track may well play.
const TRACK_LEVEL_KINDS = new Set([
  "contentNotAvailable",
  "geographicRestriction",
  "membersOnly",
  "paidContent",
  "musicPremium",
  "privateContent",
  "ageRestricted",
  "accountTerminated",
]);

/**
 * Whether a track that failed with `kind` should be skipped. A refusal of the
 * viewer or the network (a bot check, a rate limit, no connection) would fail
 * every track alike, so it stops instead, as does a streak of skips.
 */
export function shouldSkipUnplayable(kind: string, skippedInARow: number, hasNext: boolean): boolean {
  return hasNext && skippedInARow < MAX_UNPLAYABLE_SKIPS && TRACK_LEVEL_KINDS.has(kind);
}
