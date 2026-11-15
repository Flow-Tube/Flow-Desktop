import { useEffect, useRef } from "react";
import type { MouseEvent, PointerEvent, WheelEvent } from "react";
import { animate } from "framer-motion";

import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { useMusicSheetStore } from "../store/useMusicSheetStore";
import { getSettingValue } from "../store/useAppSettingsStore";
import { SETTINGS } from "./settings/schema";
import { parseSwipeAction, type MiniBarSwipeAction } from "./music/miniPlayerLook";
import {
  clampPull,
  collapseSquash,
  holdSheet,
  measureSheet,
  openDragTarget,
  queueSettle,
  settleSheet,
  sheetBox,
  sheetDockBox,
  sheetProgress,
  sheetPull,
  sheetSwipe,
  sheetTarget,
  shouldClosePulled,
} from "./musicSheet";

/** Movement before a press becomes a drag, so clicks on the dock's buttons stay clicks. */
const START_SLOP_PX = 8;
/** A trackpad swipe has no release event; it ends once the wheel goes quiet. */
const WHEEL_END_MS = 140;
/** A sideways swipe commits past this share of the bar's width. */
const SWIPE_COMMIT_SHARE = 1 / 3;
/** After closing, the bar's pull and swipe reset once its exit has played. */
const RESET_AFTER_CLOSE_MS = 400;

const playerOpen = () => useMusicPlayerStore.getState().viewState !== "dock";
const SNAP_BACK = { type: "spring", stiffness: 500, damping: 40 } as const;

type Mode = "rise" | "pull" | "swipe";

interface Drag {
  mode: Mode;
  travel: number;
  /** Pixels between the dock's top and the player's, the distance a full rise covers. */
  span: number;
  height: number;
  width: number;
  samples: Array<{ at: number; travel: number }>;
}

/** Speed over the last few samples of `travel`, in pixels a second. */
function velocityOf(samples: Drag["samples"]): number {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last || first === last) return 0;
  const seconds = (last.at - first.at) / 1000;
  return seconds > 0 ? (last.travel - first.travel) / seconds : 0;
}

function sample(samples: Drag["samples"], travel: number) {
  const now = performance.now();
  samples.push({ at: now, travel });
  while (samples.length > 2 && now - (samples[0]?.at ?? now) > 100) samples.shift();
}

/** The action set for a swipe towards the left (negative) or right. */
export function swipeActionFor(towardsLeft: boolean): MiniBarSwipeAction {
  return parseSwipeAction(getSettingValue(towardsLeft ? SETTINGS.MINI_BAR_SWIPE_LEFT_ACTION : SETTINGS.MINI_BAR_SWIPE_RIGHT_ACTION));
}

function resetAfterClose() {
  setTimeout(() => {
    sheetPull.jump(0);
    sheetSwipe.jump(0);
  }, RESET_AFTER_CLOSE_MS);
}

/** Closes the mini player by sliding it down and out, as a pull past half its height does. */
function closePulled(height: number) {
  void animate(sheetPull, clampPull(Infinity, height), { duration: 0.15, ease: "easeIn" }).then(() => {
    useMusicPlayerStore.getState().dismiss();
    resetAfterClose();
  });
}

/** Runs a committed sideways swipe: the bar flies off, then plays the next song, the previous one, or closes. */
function commitSwipe(action: MiniBarSwipeAction, towardsLeft: boolean, width: number) {
  const away = towardsLeft ? -width : width;
  void animate(sheetSwipe, away, { duration: 0.16, ease: "easeIn" }).then(() => {
    const player = useMusicPlayerStore.getState();
    if (action === "close") {
      player.dismiss();
      resetAfterClose();
      return;
    }
    if (action === "next") player.next();
    else if (action === "previous") player.previous();
    // The new song comes in from the other side, as Android's fly-through.
    sheetSwipe.jump(-away / 3);
    void animate(sheetSwipe, 0, SNAP_BACK);
  });
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
 * Android's mini player drags for the dock, with the mouse or two fingers on a trackpad: up grows
 * the full player out of it under the pointer, down pulls it away to close it, and sideways runs
 * the swipe action chosen in Settings. A release finishes or springs back each one.
 */
export function useSheetDrag(): SheetDragBind {
  const drag = useRef<Drag | null>(null);
  const press = useRef<{ id: number; x: number; y: number } | null>(null);
  const swallowClick = useRef(false);
  const wandered = useRef(false);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(wheelTimer.current), []);

  const begin = (mode: Mode): boolean => {
    // Chromium keeps sending a wheel gesture to the element it began on, so the dock still gets
    // wheels once the player it opened covers it, and taking the sheet then would sink an open player.
    const dock = sheetDockBox();
    if (!dock || playerOpen()) return false;
    measureSheet();
    if (mode === "rise") {
      holdSheet();
      useMusicSheetStore.getState().setPeeking(true);
    }
    sheetPull.stop();
    sheetSwipe.stop();
    drag.current = {
      mode,
      travel: 0,
      span: Math.max(1, dock.top - sheetBox().top),
      height: dock.bottom - dock.top,
      width: dock.right - dock.left,
      samples: [],
    };
    return true;
  };

  const move = (travel: number) => {
    const d = drag.current;
    if (!d || playerOpen()) return;
    d.travel = travel;
    sample(d.samples, travel);
    if (d.mode === "rise") sheetProgress.set(Math.min(1, Math.max(0, travel / d.span)));
    else if (d.mode === "pull") sheetPull.set(clampPull(travel, d.height));
    else sheetSwipe.set(travel);
  };

  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.mode === "pull") {
      if (shouldClosePulled(sheetPull.get(), d.height, velocityOf(d.samples))) closePulled(d.height);
      else void animate(sheetPull, 0, SNAP_BACK);
      return;
    }
    if (d.mode === "swipe") {
      const towardsLeft = d.travel < 0;
      const action = swipeActionFor(towardsLeft);
      if (action !== "nothing" && Math.abs(d.travel) > d.width * SWIPE_COMMIT_SHARE) commitSwipe(action, towardsLeft, d.width);
      else void animate(sheetSwipe, 0, SNAP_BACK);
      return;
    }
    // A click on the dock can open the player while a wheel drag waits to end; the player's own settle stands.
    if (playerOpen()) {
      useMusicSheetStore.getState().setPeeking(false);
      return;
    }
    if (sheetTarget(sheetProgress.get(), velocityOf(d.samples)) === 1) {
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
      wandered.current = false;
      press.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    },
    onPointerMove: (event) => {
      const p = press.current;
      if (!p || p.id !== event.pointerId) return;
      const up = p.y - event.clientY;
      const right = event.clientX - p.x;
      if (!drag.current) {
        const sideways = Math.abs(right) > START_SLOP_PX && Math.abs(right) >= Math.abs(up);
        const mode: Mode | null = sideways
          ? swipeActionFor(right < 0) === "nothing" && swipeActionFor(right > 0) === "nothing"
            ? null
            : "swipe"
          : up >= START_SLOP_PX
            ? "rise"
            : up <= -START_SLOP_PX
              ? "pull"
              : null;
        if (!mode) {
          if (sideways) {
            press.current = null;
            wandered.current = true;
          }
          return;
        }
        if (!begin(mode)) {
          press.current = null;
          return;
        }
        event.currentTarget.setPointerCapture?.(event.pointerId);
        swallowClick.current = true;
      }
      const mode = drag.current?.mode;
      move(mode === "rise" ? up : mode === "pull" ? -up : right);
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
        const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);
        // A swipe up rises and a sideways one swipes when an action is set. Closing takes a drag:
        // a mouse wheel turned up over the bar while scrolling the page must never close it.
        const mode: Mode | null = sideways
          ? swipeActionFor(true) === "nothing" && swipeActionFor(false) === "nothing"
            ? null
            : "swipe"
          : event.deltaY > 0
            ? "rise"
            : null;
        if (!mode || !begin(mode)) return;
      }
      const d = drag.current;
      if (!d) return;
      move(d.travel + (d.mode === "swipe" ? -event.deltaX : event.deltaY));
      clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(end, WHEEL_END_MS);
    },
    onClickCapture: (event) => {
      // A press that drifted is not a tap on the dock itself, though a button under it still counts.
      const drifted = wandered.current && (event.target as HTMLElement).closest("button") === null;
      wandered.current = false;
      if (!swallowClick.current && !drifted) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

/** Controls, menus and anything that scrolls keep their own drags inside the open player. */
const OWN_DRAG = "button, a, input, select, textarea, [role='slider'], [role='menu'], [contenteditable='true'], [data-sheet-drag-ignore]";

function keepsItsOwnDrag(target: EventTarget | null, root: HTMLElement): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest(OWN_DRAG)) return true;
  for (let node: Element | null = target; node && node !== root; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return true;
  }
  return false;
}

interface OpenDrag {
  down: number;
  span: number;
  samples: Drag["samples"];
}

/** Collapses the open player from a drag down: Android's rule picks the end, landing squashed. */
function finishOpenDrag(d: OpenDrag) {
  const progress = sheetProgress.get();
  if (openDragTarget(progress, d.down, velocityOf(d.samples)) === 0) {
    queueSettle({ squash: collapseSquash(progress) });
    useMusicPlayerStore.getState().closeOverlay();
  } else {
    void settleSheet(1);
  }
}

/**
 * The open player's drag down, as on Android: with the mouse or two fingers on the cover, the
 * background or the top bar, the card shrinks back towards the mini player under the pointer.
 * Up next, the lyrics, sliders and buttons keep their own drags and scrolls.
 */
export function usePlayerDrag(): SheetDragBind {
  const drag = useRef<OpenDrag | null>(null);
  const press = useRef<{ id: number; x: number; y: number } | null>(null);
  const swallowClick = useRef(false);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(wheelTimer.current), []);

  const begin = (): boolean => {
    if (!playerOpen()) return false;
    holdSheet();
    measureSheet();
    const dock = sheetDockBox();
    const sheet = sheetBox();
    drag.current = { down: 0, span: Math.max(1, (dock?.top ?? sheet.bottom) - sheet.top), samples: [] };
    return true;
  };

  const move = (down: number) => {
    const d = drag.current;
    if (!d) return;
    d.down = down;
    sample(d.samples, down);
    sheetProgress.set(Math.min(1, Math.max(0, 1 - down / d.span)));
  };

  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (d) finishOpenDrag(d);
  };

  return {
    onPointerDown: (event) => {
      if (event.button !== 0 || keepsItsOwnDrag(event.target, event.currentTarget)) return;
      swallowClick.current = false;
      press.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    },
    onPointerMove: (event) => {
      const p = press.current;
      if (!p || p.id !== event.pointerId) return;
      const down = event.clientY - p.y;
      if (!drag.current) {
        const dx = Math.abs(event.clientX - p.x);
        if ((dx > START_SLOP_PX && dx >= Math.abs(down)) || down < -START_SLOP_PX) {
          press.current = null;
          return;
        }
        if (down < START_SLOP_PX || !begin()) return;
        // A drag that began on the song's title would otherwise select it as it goes.
        window.getSelection()?.removeAllRanges();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        swallowClick.current = true;
      }
      move(down);
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
      if (keepsItsOwnDrag(event.target, event.currentTarget)) return;
      if (!drag.current) {
        // Only a mostly downward swipe collapses; the opposite way is what opened it.
        if (event.deltaY >= 0 || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        if (!begin()) return;
      }
      move((drag.current?.down ?? 0) - event.deltaY);
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
