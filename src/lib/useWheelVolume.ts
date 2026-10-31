import { useCallback, useEffect, useRef } from "react";
import { volumeAfterWheel } from "./musicPlayerKeys";

export interface UseWheelVolumeOptions {
  volume: number;
  muted: boolean;
  onVolumeChange: (volume: number) => void;
  onMuteChange?: (muted: boolean) => void;
}

/**
 * Attaches a non-passive wheel event listener that adjusts volume via `volumeAfterWheel`
 * and calls `event.preventDefault()` + `event.stopPropagation()` so the wheel event
 * does not trigger scrolling in parent containers (such as Shorts snap-scroll or page scroll).
 *
 * Uses a callback ref so it attaches correctly even when conditionally rendered (e.g. `{active && <div ref={ref} />}`).
 */
export function useWheelVolume<T extends HTMLElement = HTMLDivElement>({
  volume,
  muted,
  onVolumeChange,
  onMuteChange,
}: UseWheelVolumeOptions) {
  const stateRef = useRef({ volume, muted, onVolumeChange, onMuteChange });
  stateRef.current = { volume, muted, onVolumeChange, onMuteChange };

  const cleanupRef = useRef<(() => void) | null>(null);

  const ref = useCallback((node: T | null) => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    if (node) {
      const handleWheel = (event: WheelEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const { volume, muted, onVolumeChange, onMuteChange } = stateRef.current;
        const current = muted ? 0 : volume;
        const next = volumeAfterWheel(current, event.deltaY);
        if (muted && next > 0) onMuteChange?.(false);
        else if (!muted && next === 0) onMuteChange?.(true);
        onVolumeChange(next);
      };

      node.addEventListener("wheel", handleWheel, { passive: false });
      cleanupRef.current = () => {
        node.removeEventListener("wheel", handleWheel);
      };
    }
  }, []);

  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  return ref;
}
