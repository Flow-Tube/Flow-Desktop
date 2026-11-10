import { onSystemOutputSilent, watchSystemOutput } from "../api/systemOutput";
import { SETTINGS } from "../settings/schema";
import { getSettingValue, useAppSettingsStore } from "../../store/useAppSettingsStore";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";

export type MutePauseAction = "pause" | "resume" | "none";

/**
 * Pause music when Flow is muted and resume it when sound comes back, but only music this pause
 * stopped: a song the listener paused by hand stays paused when they turn the volume up.
 */
export function mutePauseAction(silent: boolean, enabled: boolean, isPlaying: boolean, pausedForMute: boolean): MutePauseAction {
  if (silent && enabled && isPlaying) return "pause";
  if (!silent && pausedForMute) return "resume";
  return "none";
}

/**
 * Follows "Pause music when muted". Flow for Android listens to the phone's media volume, so
 * besides Flow's own mute and slider this follows the computer's sound output, which the backend
 * watches only while the setting is on.
 */
export function bindMutePause(): void {
  const enabled = () => getSettingValue(SETTINGS.MUSIC_PAUSE_WHEN_MUTED) === "true";
  let pausedForMute = false;
  let systemSilent = false;

  const apply = () => {
    const state = useMusicPlayerStore.getState();
    const silent = systemSilent || state.isMuted || state.volume <= 0;
    const action = mutePauseAction(silent, enabled(), state.isPlaying, pausedForMute);
    if (action === "pause") {
      pausedForMute = true;
      state.pause();
    } else if (action === "resume") {
      pausedForMute = false;
      state.play();
    }
  };

  let watching = false;
  const followSetting = () => {
    if (enabled() === watching) return;
    watching = enabled();
    if (!watching) systemSilent = false;
    void watchSystemOutput(watching);
  };
  followSetting();
  useAppSettingsStore.subscribe((state, previous) => {
    if (state.values !== previous.values) followSetting();
  });

  void onSystemOutputSilent((silent) => {
    if (!watching || silent === systemSilent) return;
    systemSilent = silent;
    apply();
  });

  // Only a change in sound acts, as on Android: music the listener starts again while it is
  // silent is theirs, so it keeps playing and isn't brought back by this later.
  useMusicPlayerStore.subscribe((state, previous) => {
    if (state.isPlaying && !previous.isPlaying) pausedForMute = false;
    if (state.isMuted !== previous.isMuted || state.volume !== previous.volume) apply();
  });
}
