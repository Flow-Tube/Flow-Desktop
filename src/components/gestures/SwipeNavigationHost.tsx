import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { SWIPE_COMMIT_PX, swipeHistoryDelta, swipeMayNavigate } from "../../lib/gestures/swipeNav";
import { GESTURE_GAP_MS, newWheelGestureState, trackWheelGesture } from "../../lib/gestures/wheelAxis";
import { useTrackpadGesturesEnabled } from "../../lib/gestures/trackpadGestures";
import { activeTab, useTabsStore } from "../../store/useTabsStore";

type Hint = { delta: -1 | 1; progress: number };

function canGo(delta: -1 | 1): boolean {
  const tab = activeTab(useTabsStore.getState());
  return delta < 0 ? tab.index > 0 : tab.index < tab.entries.length - 1;
}

/**
 * A two-finger sideways swipe goes back or forward in the tab's history, as in Safari and Edge. An
 * arrow fills in at the edge as the fingers travel; past the line the page changes, and the rest of
 * that swipe's momentum does nothing.
 */
export function SwipeNavigationHost() {
  const enabled = useTrackpadGesturesEnabled();
  const [hint, setHint] = useState<Hint | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const state = newWheelGestureState();
    let allowed = false;
    let hide: number | undefined;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey) return;
      const wasLocked = state.axis !== null && event.timeStamp - state.lastAt <= GESTURE_GAP_MS;
      trackWheelGesture(state, event.deltaX, event.deltaY, event.deltaMode, event.timeStamp);
      window.clearTimeout(hide);
      hide = window.setTimeout(() => setHint(null), GESTURE_GAP_MS);
      if (state.axis !== "x" || state.done) return;
      if (!wasLocked) allowed = swipeMayNavigate(event.target, event.deltaX);
      const delta = swipeHistoryDelta(state.travel, document.documentElement.dir === "rtl");
      if (!allowed || !canGo(delta)) {
        setHint(null);
        return;
      }
      const progress = Math.min(1, Math.abs(state.travel) / SWIPE_COMMIT_PX);
      setHint({ delta, progress });
      if (progress < 1) return;
      state.done = true;
      useTabsStore.getState().go(delta);
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.clearTimeout(hide);
    };
  }, [enabled]);

  if (!hint) return null;
  const back = hint.delta < 0;
  const Icon = back ? ArrowLeft : ArrowRight;
  return (
    <div
      aria-hidden="true"
      // Placed with an inline transform only: Tailwind's translate classes would multiply with it.
      className={`pointer-events-none fixed top-1/2 z-[90] grid h-11 w-11 place-items-center rounded-full border border-chrome-neutral-800 ${
        back ? "start-3" : "end-3"
      } ${hint.progress >= 1 ? "bg-primary text-on-primary" : "bg-surface-container-high text-chrome-neutral-100"}`}
      style={{ opacity: 0.3 + hint.progress * 0.7, transform: `translateY(-50%) scale(${0.7 + hint.progress * 0.3})` }}
    >
      <Icon size={20} className="rtl:-scale-x-100" />
    </div>
  );
}
