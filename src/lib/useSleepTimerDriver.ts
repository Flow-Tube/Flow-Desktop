import { useEffect } from "react";

import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { useSleepTimerStore } from "../store/useSleepTimerStore";
import { musicAudioEngine } from "./audio/musicAudioEngine";
import { quitApp } from "./api/process";
import { SLEEP_FADE_SECONDS, fadeLevel } from "./sleepTimer";

/** Long enough for the pause to save the queue and the listen before Flow quits. */
const QUIT_DELAY_MS = 1_000;
/** The backstop clock for when no music plays to drive the timer. */
const FALLBACK_TICK_MS = 1_000;

let fading = false;

function stopFading(): void {
  if (!fading) return;
  fading = false;
  musicAudioEngine.resetFade();
}

/** The timer ran out: pause whatever plays, or quit Flow when that was asked for. */
function expire(): void {
  const { quitOnExpiry, cancel } = useSleepTimerStore.getState();
  cancel();
  const music = useMusicPlayerStore.getState();
  if (music.isPlaying) music.pause();
  const video = usePlayerStore.getState();
  if (video.isPlaying) video.setIsPlaying(false);
  stopFading();
  if (quitOnExpiry) setTimeout(() => void quitApp(), QUIT_DELAY_MS);
}

/** Seconds until the timer stops playback, or null when that is not known yet. */
function remainingSeconds(): number | null {
  const { mode, endsAt } = useSleepTimerStore.getState();
  if (mode === "timer" && endsAt !== null) return (endsAt - Date.now()) / 1000;
  if (mode === "endOfSong") {
    const duration = musicAudioEngine.getDuration() || useMusicPlayerStore.getState().duration;
    if (duration > 0 && useMusicPlayerStore.getState().isPlaying) return duration - musicAudioEngine.getCurrentTime();
  }
  return null;
}

/**
 * Advances the timer. The music element's `timeupdate` calls this, which keeps
 * firing in a hidden window where timers are throttled, and a one-second
 * interval covers the video player and paused music.
 */
export function tickSleepTimer(): void {
  const remaining = remainingSeconds();
  if (remaining === null) {
    stopFading();
    return;
  }
  if (useSleepTimerStore.getState().mode === "timer" && remaining <= 0) {
    expire();
    return;
  }
  if (useMusicPlayerStore.getState().isPlaying && remaining < SLEEP_FADE_SECONDS) {
    fading = true;
    musicAudioEngine.fadeOut(fadeLevel(remaining), remaining);
  } else {
    stopFading();
  }
}

/**
 * Called when a song or video plays to its end. Returns true when "End of song"
 * was waiting for it, so the player stops instead of moving on.
 */
export function sleepTimerTakesEnd(): boolean {
  if (useSleepTimerStore.getState().mode !== "endOfSong") return false;
  expire();
  return true;
}

/** Runs the shared sleep timer while one is set. */
export function useSleepTimerDriver() {
  const mode = useSleepTimerStore((s) => s.mode);

  useEffect(() => {
    if (mode === "off") {
      stopFading();
      return;
    }
    const interval = setInterval(tickSleepTimer, FALLBACK_TICK_MS);
    return () => clearInterval(interval);
  }, [mode]);
}
