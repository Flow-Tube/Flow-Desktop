import { useEffect, useRef } from "react";
import type { MouseEvent, PointerEvent, WheelEvent } from "react";

import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { useMusicSheetStore } from "../store/useMusicSheetStore";
import { holdSheet, settleSheet, sheetBox, sheetDockBox, sheetProgress, sheetTarget } from "./musicSheet";

/** Movement before a press becomes a drag, so clicks on the dock's buttons stay clicks. */
const START_SLOP_PX = 8;
/** A trackpad swipe has no release event; it ends once the wheel goes quiet. */
const WHEEL_END_MS = 140;

interface Drag {
  travel: number;
  /** Pixels between the dock's top and the player's, the distance a full drag covers. */
  span: number;
  samples: Array<{ at: number; travel: number }>;
}

/** Upward speed over the last few samples, in pixels a second. */
function upwardVelocity(samples: Drag["samples"]): number {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last || first === last) return 0;
  const seconds = (last.at - first.at) / 1000;
  return seconds > 0 ? (last.travel - first.travel) / seconds : 0;
}

export interface SheetDragBind {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
  onWheel: (event: WheelEvent<HTMLElement>) => void;
  onClickCapture: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * Android's mini player drag for the dock: drag it up with the mouse, or swipe up with two fingers
 * on a trackpad, and the full player grows out of it under the pointer. On release a fling or the
 * nearer end decides whether the player opens or sinks back into the dock.
 */
export function useSheetDrag(): SheetDragBind {
  const drag = useRef<Drag | null>(null);
  const press = useRef<{ id: number; x: number; y: number } | null>(null);
  const swallowClick = useRef(false);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(wheelTimer.current), []);

  const begin = (): boolean => {
    const dock = sheetDockBox();
    if (!dock) return false;
    holdSheet();
    drag.current = { travel: 0, span: Math.max(1, dock.top - sheetBox().top), samples: [] };
    useMusicSheetStore.getState().setPeeking(true);
    return true;
  };

  const move = (travel: number) => {
    const d = drag.current;
    if (!d) return;
    d.travel = travel;
    const now = performance.now();
    d.samples.push({ at: now, travel });
    while (d.samples.length > 2 && now - (d.samples[0]?.at ?? now) > 100) d.samples.shift();
    sheetProgress.set(Math.min(1, Math.max(0, travel / d.span)));
  };

  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (sheetTarget(sheetProgress.get(), upwardVelocity(d.samples)) === 1) {
      // The player takes it from here and finishes the growth itself.
      useMusicPlayerStore.getState().openOverlay("full");
      useMusicSheetStore.getState().setPeeking(false);
      return;
    }
    // A release sinking back must not hide a player a newer drag has brought up.
    void settleSheet(0).then((settled) => {
      if (settled) useMusicSheetStore.getState().setPeeking(false);
    });
  };

  // Parts of the dock that keep their own drags and wheels, such as the seek line, opt out.
  const ignored = (target: EventTarget) => (target as HTMLElement).closest("[data-sheet-drag-ignore]") !== null;

  return {
    onPointerDown: (event) => {
      if (event.button !== 0 || ignored(event.target)) return;
      swallowClick.current = false;
      press.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    },
    onPointerMove: (event) => {
      const p = press.current;
      if (!p || p.id !== event.pointerId) return;
      const up = p.y - event.clientY;
      if (!drag.current) {
        const dx = Math.abs(event.clientX - p.x);
        if (dx > START_SLOP_PX && dx >= Math.abs(up)) {
          press.current = null;
          return;
        }
        if (up < START_SLOP_PX) return;
        if (!begin()) {
          press.current = null;
          return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        swallowClick.current = true;
      }
      move(up);
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
      if (ignored(event.target)) return;
      if (!drag.current) {
        // Only a mostly upward swipe starts, so a sideways one or a scroll down does nothing.
        if (event.deltaY <= 0 || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        if (!begin()) return;
      }
      move((drag.current?.travel ?? 0) + event.deltaY);
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
}
