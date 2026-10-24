import type { SongItem } from "../types/music";
import { getMusicResumePosition, saveMusicResumePosition } from "./api/musicQueue";
import { SETTINGS } from "./settings/schema";
import { getSettingValue } from "../store/useAppSettingsStore";

/**
 * Long tracks (mixes, podcasts, episodes) pick up where they stopped; songs
 * always start over. Ported from Android's MusicResumePolicy, MusicResumeTracker
 * and PlaybackResumePolicy.
 */
export const LONG_TRACK_SECONDS = 10 * 60;

export const isLongTrack = (durationSeconds: number): boolean => durationSeconds >= LONG_TRACK_SECONDS;

/** Where a long track starts: its saved position, unless it was finished or barely begun. */
export function resumeStartSeconds(savedSeconds: number, durationSeconds: number): number {
  if (!isLongTrack(durationSeconds) || savedSeconds <= 0.5) return 0;
  const finished = durationSeconds - savedSeconds <= 1.5 || savedSeconds >= durationSeconds * 0.98;
  return finished ? 0 : savedSeconds;
}

const resumeEnabled = (): boolean => getSettingValue(SETTINGS.MUSIC_RESUME_LONG_TRACKS) === "true";

const idOf = (track: SongItem): string => track.videoId ?? track.id;

/** The position a fresh play of `track` starts from, 0 for a song or with the setting off. */
export async function resumePositionFor(track: SongItem): Promise<number> {
  const duration = track.duration ?? 0;
  if (!resumeEnabled() || !isLongTrack(duration)) return 0;
  const saved = await getMusicResumePosition(idOf(track)).catch(() => null);
  return saved === null ? 0 : resumeStartSeconds(saved, duration);
}

/** Remembers where a long track was left; nothing is written for songs or with the setting off. */
export function rememberResumePosition(track: SongItem, positionSeconds: number, durationSeconds: number): void {
  if (!resumeEnabled() || !isLongTrack(durationSeconds)) return;
  void saveMusicResumePosition(idOf(track), positionSeconds, durationSeconds).catch((error) =>
    console.warn("Failed to save where a long track was left", error),
  );
}
