/**
 * The music volume slider is a position, not a gain: hearing is logarithmic, so a straight gain
 * crowds every audible change into the bottom of the slider. Squaring spreads it evenly (half
 * way is -12 dB) while 0 stays silent and the top stays full volume.
 */
export const volumeGain = (position: number): number => {
  const p = Math.max(0, Math.min(1, position));
  return p * p;
};

/** The slider position that plays at `gain`, for carrying an older saved gain over. */
export const volumePosition = (gain: number): number => Math.sqrt(Math.max(0, Math.min(1, gain)));

const CONFIG_KEY = "flow_music_player";
const MARKER_KEY = "flow_music_volume_curve";

/**
 * Builds before this saved the music volume as a gain. Converting it once keeps the first launch
 * after the update exactly as loud as the last one before it.
 */
export function migrateSavedMusicVolume(): void {
  try {
    if (localStorage.getItem(MARKER_KEY)) return;
    localStorage.setItem(MARKER_KEY, "perceptual");
    const saved = localStorage.getItem(CONFIG_KEY);
    if (!saved) return;
    const config = JSON.parse(saved) as { volume?: unknown };
    if (typeof config.volume !== "number" || !Number.isFinite(config.volume)) return;
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...config, volume: volumePosition(config.volume) }));
  } catch {
    // Unreadable storage: the store falls back to its defaults anyway.
  }
}
