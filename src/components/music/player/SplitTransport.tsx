import { useState, type CSSProperties, type KeyboardEvent } from "react";
import { motion } from "framer-motion";
import { Loader2, Pause, Play, SkipBack, SkipForward } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import { SPLIT_GAP, playCornerRadius, splitSideRadius, splitWeights, type TransportPart } from "../../../lib/music/splitTransport";

/** Android's elastic spec: damping ratio 0.62 at stiffness 720, as the top bar's button group. */
const ELASTIC = { type: "spring", stiffness: 720, damping: 2 * 0.62 * Math.sqrt(720), mass: 1 } as const;

/** Height and the width of a whole row; a row of fewer parts takes its share of that width. */
const SIZES = {
  lg: { height: 68, width: 360, skipIcon: "h-7 w-7", playIcon: "h-8 w-8" },
  md: { height: 56, width: 300, skipIcon: "h-6 w-6", playIcon: "h-7 w-7" },
  sm: { height: 44, width: 220, skipIcon: "h-5 w-5", playIcon: "h-6 w-6" },
  mini: { height: 40, width: 156, skipIcon: "h-[18px] w-[18px]", playIcon: "h-6 w-6" },
} as const;

export type SplitTransportSize = keyof typeof SIZES;

/** The sides sit on the player's tonal accent; outside a player, on the theme's surfaces. */
const SIDE_STYLE: CSSProperties = {
  background: "var(--player-primary-container, var(--color-surface-container-highest))",
  color: "var(--player-on-primary-container, var(--color-on-surface))",
};
const PLAY_STYLE: CSSProperties = { background: "var(--color-primary)", color: "var(--color-on-primary)" };
const ALL: readonly TransportPart[] = ["previous", "play", "next"];

interface SplitTransportProps {
  size: SplitTransportSize;
  playing: boolean;
  loading?: boolean;
  onPrevious: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  /** What Next plays, named on hover. */
  nextTitle?: string | null;
  /** The parts shown, in order; the mini player can leave a side out. */
  parts?: readonly TransportPart[];
}

/**
 * Previous and Next as the two sides of a split button around Play/pause, as Android's
 * `MediaPlaybackControls`: the pressed part widens while the others give way, its inner corners
 * opening, all on the same elastic spring. The mini player's is the same control, smaller.
 */
export function SplitTransport({ size, playing, loading, onPrevious, onTogglePlay, onNext, nextTitle, parts = ALL }: SplitTransportProps) {
  const sizes = SIZES[size];
  const [pressed, setPressed] = useState<TransportPart | null>(null);
  const weights = splitWeights(pressed);
  const restWeights = splitWeights(null);
  const width = (sizes.width * parts.reduce((sum, p) => sum + restWeights[p], 0)) / (restWeights.previous + restWeights.play + restWeights.next);
  const press = (part: TransportPart) => ({
    onPointerDown: () => setPressed(part),
    onPointerUp: () => setPressed(null),
    onPointerLeave: () => setPressed((current) => (current === part ? null : current)),
    onPointerCancel: () => setPressed(null),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === " " || event.key === "Enter") setPressed(part);
    },
    onKeyUp: () => setPressed(null),
    onBlur: () => setPressed((current) => (current === part ? null : current)),
  });
  const cell =
    "grid min-w-0 basis-0 place-items-center outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]";

  const button = (part: TransportPart) => {
    if (part === "play") {
      return (
        <motion.button
          key={part}
          type="button"
          onClick={onTogglePlay}
          aria-label={getString(playing ? "music_pause" : "music_play")}
          initial={false}
          animate={{ flexGrow: weights.play, borderRadius: playCornerRadius(sizes.height, playing) }}
          transition={ELASTIC}
          className={cell}
          style={PLAY_STYLE}
          {...press("play")}
        >
          {loading ? (
            <Loader2 className={`${sizes.playIcon} animate-spin`} />
          ) : playing ? (
            <Pause className={sizes.playIcon} fill="currentColor" />
          ) : (
            <Play className={`${sizes.playIcon} translate-x-px`} fill="currentColor" />
          )}
        </motion.button>
      );
    }
    const isNext = part === "next";
    return (
      <motion.button
        key={part}
        type="button"
        onClick={isNext ? onNext : onPrevious}
        aria-label={getString(isNext ? "music_next" : "music_previous")}
        title={isNext && nextTitle ? `${getString("music_up_next")}: ${nextTitle}` : undefined}
        initial={false}
        animate={{ flexGrow: weights[part], borderRadius: splitSideRadius(!isNext, sizes.height, pressed === part ? 1 : 0) }}
        transition={ELASTIC}
        className={cell}
        style={SIDE_STYLE}
        {...press(part)}
      >
        {isNext ? <SkipForward className={sizes.skipIcon} fill="currentColor" /> : <SkipBack className={sizes.skipIcon} fill="currentColor" />}
      </motion.button>
    );
  };

  // Media controls run left to right in every language, as the timeline above them does.
  return (
    <div dir="ltr" className="flex max-w-full shrink-0 items-stretch" style={{ gap: SPLIT_GAP, height: sizes.height, width }}>
      {parts.map(button)}
    </div>
  );
}
