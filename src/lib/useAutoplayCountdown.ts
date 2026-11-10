import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayerStore } from "../store/usePlayerStore";
import type { VideoSummary } from "../types/video";

export interface AutoplayCountdownState {
  next: VideoSummary;
  secondsLeft: number;
}

/**
 * The wait before the next video starts. It ends when the viewer starts playing again or moves to
 * another video, so a countdown never fires over something they chose.
 */
export function useAutoplayCountdown(videoId: string | null, onElapsed: () => void) {
  const [state, setState] = useState<AutoplayCountdownState | null>(null);
  const onElapsedRef = useRef(onElapsed);
  onElapsedRef.current = onElapsed;

  const start = useCallback((seconds: number, next: VideoSummary) => {
    setState({ next, secondsLeft: seconds });
  }, []);
  const cancel = useCallback(() => setState(null), []);

  useEffect(() => cancel, [videoId, cancel]);

  const running = state !== null;
  useEffect(() => {
    if (!running) return;
    return usePlayerStore.subscribe((player, previous) => {
      if (player.isPlaying && !previous.isPlaying) setState(null);
    });
  }, [running]);

  const secondsLeft = state?.secondsLeft ?? null;
  useEffect(() => {
    if (secondsLeft === null) return;
    const timer = window.setTimeout(() => {
      if (secondsLeft > 1) {
        setState((current) => current && { ...current, secondsLeft: secondsLeft - 1 });
      } else {
        setState(null);
        onElapsedRef.current();
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft]);

  return { state, start, cancel };
}
