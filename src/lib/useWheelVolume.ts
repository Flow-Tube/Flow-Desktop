import { useCallback, useRef } from "react";

import { newWheelGesture, wheelStep, wheelVolumeChange } from "./wheelVolume";

export interface UseWheelVolumeOptions {
  /** From 0 to `max`, which is 1 unless the volume can go past 100%. */
  volume: number;
  max?: number;
  muted: boolean;
  onVolumeChange: (volume: number) => void;
  onUnmute?: () => void;
  onFeedback?: (volume: number, muted: boolean) => void;
}

/**
 * Ref for a volume control that the wheel should adjust. The listener is native because only a
 * non-passive one can stop the page or the Shorts feed scrolling too. React's `onWheel` can't.
 */
export function useWheelVolume<T extends HTMLElement = HTMLDivElement>(options: UseWheelVolumeOptions) {
  const latest = useRef(options);
  latest.current = options;

  return useCallback((node: T | null) => {
    if (!node) return;
    const gesture = newWheelGesture();
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const step = wheelStep(gesture, event.deltaY, event.deltaMode, event.timeStamp);
      if (step === 0) return;
      const { volume, muted, max, onVolumeChange, onUnmute } = latest.current;
      const change = wheelVolumeChange(volume, muted, step, max);
      if (change.unmute) onUnmute?.();
      if (change.volume !== undefined) onVolumeChange(change.volume);
      latest.current.onFeedback?.(change.volume ?? volume, change.unmute ? false : muted);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);
}
