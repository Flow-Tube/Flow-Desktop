import { SETTINGS } from "../settings/schema";
import { getSettingValue, useAppSettingsStore } from "../../store/useAppSettingsStore";
import { bindEqPersistence, useEqStore } from "../../store/useEqStore";
import { useCrossfadePauseStore } from "../../store/useCrossfadePauseStore";
import { crossfadeSettings } from "./crossfadeSettings";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { useSleepTimerStore } from "../../store/useSleepTimerStore";
import { crossfadeStart } from "./crossfade";
import type { CrossfadeCurve } from "./crossfadeRamp";
import { REFERENCE_SAMPLE_RATE } from "./eq/filterMath";
import { graphChangesSound, graphSpec } from "./eq/graphPlan";
import { changesSound } from "./eq/stateOps";
import { musicAudioEngine } from "./musicAudioEngine";
import { bindMutePause } from "./musicMutePause";

let bound = false;

/** How often the playing element's clock ticks while it plays. */
const TICK_SECONDS = 0.25;
let tickTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Called on every tick of the playing element's clock (about four a second, also while the
 * window is hidden), with its exact position: the store's own clock moves only by whole seconds.
 * A fade due before the next tick is timed to its moment, so one shorter than a tick still
 * starts. A next song already buffered fades in; one that isn't yet still gets the fade, as the
 * song fading out on its own.
 */
export function crossfadeTick(position: number): void {
  if (musicAudioEngine.isFadingThrough()) return;
  const state = useMusicPlayerStore.getState();
  const settings = crossfadeSettings();
  const speed = musicAudioEngine.getSpeed();
  const pausesAtEnd = useSleepTimerStore.getState().mode === "endOfSong";
  const start = crossfadeStart(state, settings, position, speed, pausesAtEnd);
  if (!start) {
    if (tickTimer === null && crossfadeStart(state, settings, position + TICK_SECONDS * speed, speed, pausesAtEnd)) {
      const wait = (state.duration - settings.seconds * speed - position) / speed;
      tickTimer = setTimeout(() => {
        tickTimer = null;
        crossfadeTick(musicAudioEngine.getCurrentTime());
      }, Math.max(0, wait * 1_000));
    }
    return;
  }
  const next = state.queue[start.index];
  if (next && musicAudioEngine.canPlayPreloaded(next.videoId ?? next.id)) {
    musicAudioEngine.armCrossfade(start.seconds);
    void state._loadIndex(start.index, { resumeAt: 0 });
  } else {
    musicAudioEngine.fadeThrough(start.seconds);
  }
}

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
  const applyCrossfade = () => {
    musicAudioEngine.setCrossfadeEnabled(crossfadeSettings().seconds > 0);
    musicAudioEngine.setCrossfadeCurve(getSettingValue(SETTINGS.MUSIC_CROSSFADE_CURVE) as CrossfadeCurve);
  };

  applyNormalization();
  applySpeed();
  applyCrossfade();
  useAppSettingsStore.subscribe((state, previous) => {
    if (state.values === previous.values) return;
    applyNormalization();
    applySpeed();
    applyCrossfade();
  });
  useCrossfadePauseStore.subscribe(applyCrossfade);

  bindMutePause();

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
