import { Loader2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { motion } from "framer-motion";

import { getString } from "../../../lib/i18n/index";
import { upcomingIndex } from "../../../lib/musicQueueOrder";
import { playCornerRadius, splitSideRadius, SPLIT_GAP } from "../../../lib/music/splitTransport";
import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import { HapticButton } from "../HapticButton";

const HEIGHT = 36;
const SIDE =
  "grid h-9 w-9 place-items-center bg-[var(--player-primary-container,var(--color-surface-container-highest))] text-[var(--player-on-primary-container,var(--color-on-surface))] transition-[filter] duration-150 ease-out hover:brightness-110";

export type PillTransportButton = "previous" | "play_pause" | "next";

/**
 * Previous, Play/pause and Next sitting next to each other in the Pill, drawn as one small split
 * button when Split buttons is on: the sides flat towards Play/pause, which squares while playing.
 */
export function PillTransport({ buttons, playing, busy }: { buttons: PillTransportButton[]; playing: boolean; busy: boolean }) {
  const { previous, next, togglePlay } = useMusicPlayerStore.getState();
  const nextTitle = useMusicPlayerStore((s) => s.queue[upcomingIndex(s)]?.title ?? null);
  return (
    <div dir="ltr" className="flex items-center" style={{ gap: SPLIT_GAP }}>
      {buttons.map((button, index) => {
        const leading = index === 0;
        if (button === "play_pause") {
          return (
            <motion.div key={button} initial={false} animate={{ borderRadius: playCornerRadius(40, playing) }} className="overflow-hidden">
              <HapticButton
                onClick={togglePlay}
                aria-label={getString(playing ? "music_pause" : "music_play")}
                className="grid h-10 w-12 place-items-center bg-[var(--color-primary)] text-[var(--color-on-primary)]"
              >
                {busy ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : playing ? (
                  <Pause className="h-6 w-6" fill="currentColor" />
                ) : (
                  <Play className="h-6 w-6 translate-x-px" fill="currentColor" />
                )}
              </HapticButton>
            </motion.div>
          );
        }
        const isNext = button === "next";
        return (
          <HapticButton
            key={button}
            onClick={isNext ? next : previous}
            aria-label={getString(isNext ? "music_next" : "music_previous")}
            title={isNext && nextTitle ? `${getString("music_up_next")}: ${nextTitle}` : undefined}
            className={SIDE}
            style={{ borderRadius: splitSideRadius(leading, HEIGHT, 0) }}
          >
            {isNext ? <SkipForward className="h-[18px] w-[18px]" fill="currentColor" /> : <SkipBack className="h-[18px] w-[18px]" fill="currentColor" />}
          </HapticButton>
        );
      })}
    </div>
  );
}
