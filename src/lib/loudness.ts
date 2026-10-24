/**
 * The volume factor that brings a stream mastered `loudnessDb` above the site's
 * target down to it. Only ever turns down: a quiet stream is left as it is
 * rather than pushed past full volume.
 */
export function loudnessFactor(loudnessDb: number | null | undefined, enabled: boolean): number {
  if (!enabled || loudnessDb == null || !Number.isFinite(loudnessDb)) return 1;
  return Math.min(1, Math.pow(10, -loudnessDb / 20));
}
