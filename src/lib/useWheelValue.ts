import { useCallback, useRef } from "react";

import { newWheelGesture, stepValueAfterWheel, wheelStep } from "./wheelVolume";

export interface UseWheelValueOptions {
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

/**
 * Ref for any range control (like a slider) that the wheel should adjust.
 * Uses a non-passive listener to prevent page scrolling while adjusting.
 * When disabled, wheel events pass through without being intercepted.
 */
export function useWheelValue<T extends HTMLElement = HTMLDivElement>(options: UseWheelValueOptions) {
  const latest = useRef(options);
  latest.current = options;

  return useCallback((node: T | null) => {
    if (!node) return;
    const gesture = newWheelGesture();
    const onWheel = (event: WheelEvent) => {
      if (latest.current.disabled) return;

      event.preventDefault();
      event.stopPropagation();

      const step = wheelStep(gesture, event.deltaY, event.deltaMode, event.timeStamp);
      if (step === 0) return;

      const { value, min, max, step: stepSize = 1, onChange } = latest.current;
      const nextValue = stepValueAfterWheel(value, step, stepSize, min, max);
      if (nextValue !== value) {
        onChange(nextValue);
      }
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);
}
