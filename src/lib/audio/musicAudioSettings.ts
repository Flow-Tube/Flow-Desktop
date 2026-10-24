import { SETTINGS } from "../settings/schema";
import { getSettingValue, useAppSettingsStore } from "../../store/useAppSettingsStore";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";

let bound = false;

/**
 * Keeps the music player on the saved music audio settings. They load from SQLite after the
 * player starts, and a restore or a sync can change them later, so they are followed rather
 * than read once.
 */
export function bindMusicAudioSettings(): void {
  if (bound) return;
  bound = true;

  const applyNormalization = () => {
    const enabled = getSettingValue(SETTINGS.MUSIC_LOUDNESS_NORMALIZATION) === "true";
    const player = useMusicPlayerStore.getState();
    if (player.normalizationEnabled !== enabled) player.setNormalizationEnabled(enabled);
  };

  applyNormalization();
  useAppSettingsStore.subscribe((state, previous) => {
    if (state.values !== previous.values) applyNormalization();
  });
}
