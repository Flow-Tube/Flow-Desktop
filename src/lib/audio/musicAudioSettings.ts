import { SETTINGS } from "../settings/schema";
import { getSettingValue, useAppSettingsStore } from "../../store/useAppSettingsStore";
import { bindEqPersistence, useEqStore } from "../../store/useEqStore";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { REFERENCE_SAMPLE_RATE } from "./eq/filterMath";
import { graphChangesSound, graphSpec } from "./eq/graphPlan";
import { changesSound } from "./eq/stateOps";
import { musicAudioEngine } from "./musicAudioEngine";

let bound = false;

/**
 * Keeps the music player on the saved music audio settings and the equalizer. They load from
 * SQLite after the player starts, and a restore or a sync can change them later, so they are
 * followed rather than read once.
 */
export function bindMusicAudioSettings(): void {
  if (bound) return;
  bound = true;

  const applyNormalization = () => {
    const enabled = getSettingValue(SETTINGS.MUSIC_LOUDNESS_NORMALIZATION) === "true";
    const player = useMusicPlayerStore.getState();
    if (player.normalizationEnabled !== enabled) player.setNormalizationEnabled(enabled);
  };
  const applySpeed = () => musicAudioEngine.setSpeed(Number(getSettingValue(SETTINGS.MUSIC_PLAYBACK_SPEED)));

  applyNormalization();
  applySpeed();
  useAppSettingsStore.subscribe((state, previous) => {
    if (state.values === previous.values) return;
    applyNormalization();
    applySpeed();
  });

  const applyEq = () => {
    const { state, bypass, preview } = useEqStore.getState();
    // Compare and a drag preview never build the graph on their own: they only matter once the
    // saved curve already changes the sound, or for a preview that does.
    const spec = graphSpec(state, bypass, preview);
    const engaged =
      changesSound(state) ||
      (preview !== null && graphChangesSound(graphSpec(state, false, preview), REFERENCE_SAMPLE_RATE));
    musicAudioEngine.setEq(spec, engaged);
  };
  applyEq();
  useEqStore.subscribe((state, previous) => {
    if (state.state !== previous.state || state.bypass !== previous.bypass || state.preview !== previous.preview) {
      applyEq();
    }
  });
  bindEqPersistence();
}
