import { useState } from "react";
import { motion, useMotionValueEvent, useTransform } from "framer-motion";
import { SkipBack, SkipForward, X } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import { sheetSwipe } from "../../../lib/musicSheet";
import { swipeActionFor } from "../../../lib/useSheetDrag";
import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import { upcomingIndex } from "../../../lib/musicQueueOrder";
import { MusicArtwork } from "../MusicArtwork";

/**
 * What a sideways swipe on the mini player uncovers, as Android's `MusicBarSwipeReveal`: the next or
 * previous song with its cover, or Close, on the side the bar moves away from.
 */
export function BarSwipeReveal({ rounded }: { rounded: string }) {
  const [towardsLeft, setTowardsLeft] = useState<boolean | null>(null);
  useMotionValueEvent(sheetSwipe, "change", (x) => setTowardsLeft(x === 0 ? null : x < 0));
  const opacity = useTransform(sheetSwipe, (x) => Math.min(1, Math.abs(x) / 48));
  const queue = useMusicPlayerStore((s) => s.queue);
  const nextIndex = useMusicPlayerStore(upcomingIndex);
  const currentIndex = useMusicPlayerStore((s) => s.currentIndex);
  if (towardsLeft === null) return null;

  const action = swipeActionFor(towardsLeft);
  if (action === "nothing") return null;
  const track = action === "next" ? queue[nextIndex] : action === "previous" && currentIndex > 0 ? queue[currentIndex - 1] : undefined;
  const label =
    action === "close"
      ? getString("mini_bar_swipe_close")
      : (track?.title ?? getString(action === "next" ? "mini_bar_nothing_next" : "mini_bar_nothing_previous"));
  const Icon = action === "close" ? X : action === "next" ? SkipForward : SkipBack;

  return (
    <motion.div
      aria-hidden
      style={{ opacity }}
      className={`absolute inset-0 flex items-center gap-3 overflow-hidden px-5 ${rounded} ${
        action === "close" ? "bg-[var(--color-error)] text-chrome-white" : "bg-surface-container-highest text-chrome-neutral-100"
      } ${towardsLeft ? "flex-row-reverse" : ""}`}
    >
      <Icon className="h-5 w-5 shrink-0" />
      {track && <MusicArtwork src={track.thumbnail} alt="" className="h-9 w-9 shrink-0 rounded-md" />}
      <span className="min-w-0 truncate text-sm font-medium">{label}</span>
    </motion.div>
  );
}
