import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useTransform } from "framer-motion";

import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import { useMusicSheetStore } from "../../../store/useMusicSheetStore";
import {
  cardBox,
  dockOpacity,
  measureSheet,
  pullOpacity,
  registerSheetDock,
  settleSheet,
  sheetProgress,
  sheetPull,
  sheetMeasured,
  sheetRest,
  sheetStretch,
  sheetSwipe,
} from "../../../lib/musicSheet";
import { BarSwipeReveal } from "./BarSwipeReveal";
import { FullLayer } from "./FullLayer";
import { MiniBar, MiniChrome, useMiniPlayer } from "./MiniLayer";

const ENTER = { type: "spring", stiffness: 420, damping: 38, mass: 0.9 } as const;
const REST_SHADOW = "0 8px 24px rgb(0 0 0 / 0.35)";

/**
 * Whether the full player is drawn: while open, while the mini player is dragged up, and while it
 * sinks back after closing. Opening and closing settle the one progress the card follows.
 */
function useFullPlayerShown(): { open: boolean; shown: boolean } {
  const hasTrack = useMusicPlayerStore((s) => s.currentTrack !== null);
  const viewState = useMusicPlayerStore((s) => s.viewState);
  const peeking = useMusicSheetStore((s) => s.peeking);
  const open = hasTrack && viewState !== "dock";
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) {
      setClosing(false);
      void settleSheet(1);
    } else if (sheetProgress.get() > 0 && !useMusicSheetStore.getState().peeking) {
      setClosing(true);
      void settleSheet(0).then((settled) => {
        if (settled) setClosing(false);
      });
    }
  }, [open]);
  return { open, shown: hasTrack && (open || peeking || closing) };
}

/**
 * The music player as one card, as Android's `UnifiedMusicPlayerSheet`: the card grows from the
 * mini player's box to the whole window and back, and the mini player and the full player are two
 * layers inside it. The mini player fills the card's top edge, so it widens and lifts with it and
 * fades by halfway; the full player is laid out once at the window's size and fades in behind it.
 */
export function MusicPlayerSheet() {
  const mini = useMiniPlayer();
  const full = useFullPlayerShown();
  const visible = mini.visible || full.shown;
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const restRadius = mini.visible ? mini.restRadius : 0;

  // The card's box each frame, from the resting box measured at the start of a move.
  const box = (progress: number, pull: number) => {
    const { dock, sheet } = sheetRest();
    return cardBox(progress, pull, mini.visible ? dock : null, sheet, restRadius);
  };
  const left = useTransform([sheetProgress, sheetPull, sheetMeasured], ([p, pull]: number[]) => box(p!, pull!).left);
  const top = useTransform([sheetProgress, sheetPull, sheetMeasured], ([p, pull]: number[]) => box(p!, pull!).top);
  const width = useTransform([sheetProgress, sheetPull, sheetMeasured], ([p, pull]: number[]) => box(p!, pull!).width);
  const height = useTransform([sheetProgress, sheetPull, sheetMeasured], ([p, pull]: number[]) => box(p!, pull!).height);
  const borderRadius = useTransform(sheetProgress, (p) => restRadius * (1 - Math.min(1, Math.max(0, p))));
  // The full player stays put on screen while the card around it moves.
  const offsetX = useTransform(left, (value) => sheetRest().sheet.left - value);
  const offsetY = useTransform(top, (value) => sheetRest().sheet.top - value);
  const miniOpacity = useTransform(sheetProgress, dockOpacity);
  // A pull down fades the whole card, so it never sits see-through over the page below.
  const cardOpacity = useTransform([sheetPull, sheetMeasured], ([pull]: number[]) => {
    const dock = sheetRest().dock;
    return pullOpacity(pull!, dock ? dock.bottom - dock.top : 64);
  });
  const miniPointer = useTransform(sheetProgress, (p) => (p < 0.5 ? "auto" : "none"));
  const boxShadow = useTransform([sheetProgress, sheetPull, sheetSwipe], ([p, pull, swipe]: number[]) =>
    mini.pill && p === 0 && pull === 0 && swipe === 0 ? REST_SHADOW : "none",
  );
  const [raised, setRaised] = useState(false);
  useMotionValueEvent(sheetProgress, "change", (p) => setRaised(p > 0));

  // The resting box is measured when the bar first shows and whenever it or the window resizes.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    registerSheetDock(anchor);
    measureSheet();
    if (!anchor) return;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measureSheet());
    observer?.observe(anchor);
    window.addEventListener("resize", measureSheet);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measureSheet);
      registerSheetDock(null);
    };
  }, [mini.visible, mini.widthClass]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="music-sheet"
          initial={{ y: 96, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 96, opacity: 0 }}
          transition={ENTER}
          // A positioned layer the size of the window: everything inside is placed in window
          // coordinates, and only the card and the bar's popovers take the pointer.
          className={`pointer-events-none fixed inset-0 ${raised || full.shown ? "z-[60]" : "z-50"}`}
        >
          {mini.visible && !mini.away && (
            <div className={`absolute inset-x-0 bottom-6 mx-auto ${mini.widthClass}`}>
              <BarSwipeReveal rounded={mini.pill ? "rounded-full" : "rounded-2xl"} />
            </div>
          )}

          <motion.div
            className={`pointer-events-auto absolute overflow-hidden bg-surface-container-high ${
              mini.visible && mini.surface.bordered ? "border border-chrome-neutral-800" : ""
            }`}
            style={{ ...(mini.visible ? mini.barStyle : {}), left, top, width, height, borderRadius, boxShadow, opacity: cardOpacity, x: sheetSwipe, scaleY: sheetStretch, originY: 1 }}
          >
            {full.shown && <FullLayer offsetX={offsetX} offsetY={offsetY} />}
            {mini.visible && (
              <motion.div
                inert={!mini.docked}
                style={{ opacity: miniOpacity, pointerEvents: miniPointer }}
                className={`absolute inset-x-0 top-0 ${mini.pill ? "h-16" : "h-[72px]"}`}
              >
                <MiniBar mini={mini} />
              </motion.div>
            )}
          </motion.div>

          {mini.visible && (
            // Where the bar rests: the card measures its resting box from here, and the bar's
            // popovers hang from it outside the card's clip.
            <div ref={anchorRef} inert={!mini.docked} className={`absolute inset-x-0 bottom-6 mx-auto ${mini.widthClass}`}>
              <MiniChrome mini={mini} />
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
