import { useLayoutEffect, useRef, type RefObject } from "react";
import { MOTION_EASE, motionMs } from "./motion";

export const PAGE_RISE_PX = 8;

export function pageEnterKeyframes(rise: boolean): Keyframe[] {
  return rise
    ? [{ opacity: 0, transform: `translateY(${PAGE_RISE_PX}px)` }, { opacity: 1, transform: "none" }]
    : [{ opacity: 0 }, { opacity: 1 }];
}

/*
  Fades the element in whenever `key` changes, and never on first mount, so the app
  opens still. Nothing animates out: keeping the old page mounted would double the
  render work. `rise` adds a small upward move for pages whose layout can take it.
*/
export function usePageEnterMotion(ref: RefObject<HTMLElement | null>, key: string, rise: boolean) {
  const shownKey = useRef(key);
  const running = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    if (shownKey.current === key) return;
    shownKey.current = key;
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    const duration = motionMs("--motion-page");
    if (duration <= 0) return;
    // Fast clicking restarts the fade rather than stacking a second one on top.
    running.current?.cancel();
    running.current = el.animate(pageEnterKeyframes(rise), { duration, easing: MOTION_EASE });
  }, [key, rise, ref]);
}
