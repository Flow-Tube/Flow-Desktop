import { useCallback, useRef } from "react";

import { usePlayerStore } from "../store/usePlayerStore";
import { newWheelGesture, wheelStep } from "./wheelVolume";

interface UseWheelSeekOptions {
  enabled: boolean;
  /** Seconds per wheel step: the seek interval. */
  step: number;
  duration: number;
  seekTo: (time: number) => void;
}

/**
 * Ref for a seek bar the wheel should move along: up or away goes forward by one seek step. The time
 * is read when the wheel turns, so the controls don't re-render as the video plays.
 */
export function useWheelSeek<T extends HTMLElement = HTMLDivElement>(options: UseWheelSeekOptions) {
  const latest = useRef(options);
  latest.current = options;

  return useCallback((node: T | null) => {
    if (!node) return;
    const gesture = newWheelGesture();
    const onWheel = (event: WheelEvent) => {
      const { enabled, step, duration, seekTo } = latest.current;
      if (!enabled || !(duration > 0) || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
      const direction = wheelStep(gesture, delta, event.deltaMode, event.timeStamp);
      if (direction === 0) return;
      const now = usePlayerStore.getState().currentTime;
      seekTo(Math.min(duration, Math.max(0, now - direction * step)));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);
}
