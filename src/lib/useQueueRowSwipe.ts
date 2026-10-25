import { useEffect, useRef, useState } from "react";
import type { MouseEvent, PointerEvent, WheelEvent } from "react";
import { animate, useMotionValue, type MotionValue } from "framer-motion";

import { inCommitZone, inTension, tensionOffset } from "./queueRowSwipe";

// Android's springs: the break-through is damping 0.8 at low stiffness, the settle medium bouncy at
// medium stiffness. framer takes damping as a force, 2·ratio·√stiffness for a unit mass.
const BREAK_SPRING = { type: "spring", stiffness: 200, damping: 2 * 0.8 * Math.sqrt(200) } as const;
const SETTLE_SPRING = { type: "spring", stiffness: 1500, damping: 2 * 0.5 * Math.sqrt(1500) } as const;
const FLY_OFF = { duration: 0.18, ease: [0.4, 0, 0.2, 1] } as const;
const SWING = { duration: 0.11, ease: [0.4, 0, 0.2, 1] } as const;

/** Movement before a press becomes a swipe, so clicks and vertical scrolls stay what they are. */
const START_SLOP_PX = 8;
/** A trackpad swipe has no release event; it ends once the wheel goes quiet. */
const WHEEL_END_MS = 140;

interface Gesture {
  travel: number;
  free: boolean;
}

export interface QueueRowSwipe {
  x: MotionValue<number>;
  /** -1 while the row moves left, 1 while it moves right, 0 at rest. */
  side: -1 | 0 | 1;
  targeted: boolean;
  bind: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: () => void;
    onWheel: (event: WheelEvent<HTMLElement>) => void;
    onClickCapture: (event: MouseEvent<HTMLElement>) => void;
  };
}

/**
 * Android's four-phase queue row swipe for a mouse drag or a two-finger trackpad swipe: tension,
 * a spring as the row breaks free, 1:1 tracking, then a fly-off, a swing back or a settle. The row
 * position lives in a motion value, so a swipe never re-renders the row per frame.
 */
export function useQueueRowSwipe(
  enabled: boolean,
  widthOf: () => number,
  flyOffOnCommit: (towardsLeft: boolean) => boolean,
  onCommit: (towardsLeft: boolean) => void,
): QueueRowSwipe {
  const x = useMotionValue(0);
  const [side, setSide] = useState<-1 | 0 | 1>(0);
  const [targeted, setTargeted] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const press = useRef<{ id: number; x: number; y: number } | null>(null);
  const settling = useRef(false);
  const swallowClick = useRef(false);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const callbacks = useRef({ widthOf, flyOffOnCommit, onCommit });
  callbacks.current = { widthOf, flyOffOnCommit, onCommit };

  useEffect(() => {
    const unsubscribe = x.on("change", (value) => setSide(value < 0 ? -1 : value > 0 ? 1 : 0));
    return () => {
      unsubscribe();
      clearTimeout(wheelTimer.current);
    };
  }, [x]);

  const begin = () => {
    x.stop();
    gesture.current = { travel: 0, free: false };
    setTargeted(false);
  };

  const move = (travel: number) => {
    const g = gesture.current;
    if (!g) return;
    g.travel = travel;
    if (!g.free) {
      if (inTension(travel)) {
        x.set(tensionOffset(travel));
        return;
      }
      g.free = true;
      animate(x, travel, BREAK_SPRING);
    } else {
      x.set(travel);
    }
    setTargeted(inCommitZone(travel, callbacks.current.widthOf()));
  };

  const end = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const width = callbacks.current.widthOf();
    setTargeted(false);
    if (!inCommitZone(g.travel, width)) {
      animate(x, 0, SETTLE_SPRING);
      return;
    }
    const towardsLeft = g.travel < 0;
    const direction = towardsLeft ? -1 : 1;
    settling.current = true;
    const flyOff = callbacks.current.flyOffOnCommit(towardsLeft);
    void animate(x, direction * width * (flyOff ? 1 : 0.5), flyOff ? FLY_OFF : SWING).then(() => {
      callbacks.current.onCommit(towardsLeft);
      // A row that left the list unmounts; one that stays swings home.
      return animate(x, 0, SETTLE_SPRING);
    }).finally(() => {
      settling.current = false;
    });
  };

  const bind: QueueRowSwipe["bind"] = {
    onPointerDown: (event) => {
      if (!enabled || settling.current || event.button !== 0 || event.pointerType === "touch") return;
      // The drag handle reorders; a swipe never starts there.
      if ((event.target as HTMLElement).closest("[data-drag-handle]")) return;
      swallowClick.current = false;
      press.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    },
    onPointerMove: (event) => {
      const p = press.current;
      if (!p || p.id !== event.pointerId) return;
      const dx = event.clientX - p.x;
      if (!gesture.current) {
        const dy = event.clientY - p.y;
        if (Math.abs(dy) > START_SLOP_PX && Math.abs(dy) >= Math.abs(dx)) {
          press.current = null;
          return;
        }
        if (Math.abs(dx) < START_SLOP_PX || Math.abs(dx) < Math.abs(dy)) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        swallowClick.current = true;
        begin();
      }
      move(dx);
    },
    onPointerUp: (event) => {
      if (press.current?.id !== event.pointerId) return;
      press.current = null;
      end();
    },
    onPointerCancel: () => {
      press.current = null;
      end();
    },
    onWheel: (event) => {
      if (!enabled || settling.current) return;
      if (!gesture.current) {
        // Only a mostly sideways scroll starts a swipe, so the list still scrolls as before.
        if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || Math.abs(event.deltaX) < 2) return;
        begin();
      }
      move((gesture.current?.travel ?? 0) - event.deltaX);
      clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(end, WHEEL_END_MS);
    },
    onClickCapture: (event) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };

  return { x, side, targeted, bind };
}
