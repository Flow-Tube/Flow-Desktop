/** Android's floor for music: a track is never turned down by more than this (`LoudnessGain`). */
export const MUSIC_MAX_CUT_DB = 20;

/**
 * The volume factor that brings a stream mastered `loudnessDb` above the site's
 * target down to it. Only ever turns down: a quiet stream is left as it is
 * rather than pushed past full volume. `maxCutDb` caps how far down it goes.
 */
export function loudnessFactor(
  loudnessDb: number | null | undefined,
  enabled: boolean,
  maxCutDb = Number.POSITIVE_INFINITY,
): number {
  if (!enabled || loudnessDb == null || !Number.isFinite(loudnessDb)) return 1;
  const cutDb = Math.min(Math.max(0, loudnessDb), maxCutDb);
  return Math.pow(10, -cutDb / 20);
}
