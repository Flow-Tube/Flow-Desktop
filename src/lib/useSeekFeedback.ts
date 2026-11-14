import { useCallback, useEffect, useRef, useState } from "react";

import {
  SEEK_FEEDBACK_WINDOW_MS,
  SEEK_TOTAL_RESET_MS,
  nextSeekFeedback,
  type SeekDirection,
  type SeekFeedback,
} from "./seekFeedback";

/** The seek label and tint: a running total that hides after the last step, as on Android. */
export function useSeekFeedback() {
  const [feedback, setFeedback] = useState<SeekFeedback | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    hideTimerRef.current = null;
    resetTimerRef.current = null;
  };

  useEffect(() => clearTimers, []);

  const show = useCallback((direction: SeekDirection, step: number) => {
    setFeedback((previous) => nextSeekFeedback(previous, direction, step));
    clearTimers();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      setFeedback((current) => (current ? { ...current, visible: false } : current));
      resetTimerRef.current = setTimeout(() => {
        resetTimerRef.current = null;
        setFeedback(null);
      }, SEEK_TOTAL_RESET_MS);
    }, SEEK_FEEDBACK_WINDOW_MS);
  }, []);

  return { feedback, show };
}
