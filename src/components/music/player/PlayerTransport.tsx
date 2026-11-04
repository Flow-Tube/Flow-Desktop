import { Loader2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import { HapticButton } from "../HapticButton";
import { upcomingIndex } from "../../../lib/musicQueueOrder";

const SIDE = "grid h-11 w-11 place-items-center rounded-full transition-colors duration-200 ease-out";
const SIDE_IDLE = `${SIDE} text-chrome-neutral-300 hover:bg-surface-container-high hover:text-chrome-neutral-100`;
/** A switched-on toggle fills with the control container, as Android's action row does. */
const SIDE_ACTIVE = `${SIDE} bg-[var(--player-primary-container)] text-[var(--player-on-primary-container)]`;

const SIZES = {
  lg: { skip: "h-12 w-12", skipIcon: "h-7 w-7", play: "h-16 w-16", playIcon: "h-7 w-7", gap: "gap-6" },
  md: { skip: "h-11 w-11", skipIcon: "h-6 w-6", play: "h-14 w-14", playIcon: "h-6 w-6", gap: "gap-8" },
  sm: { skip: "h-9 w-9", skipIcon: "h-5 w-5", play: "h-11 w-11", playIcon: "h-6 w-6", gap: "gap-4" },
} as const;

interface TransportButtonsProps {
  size: keyof typeof SIZES;
  playing: boolean;
  loading?: boolean;
  onPrevious: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  /** What Next plays, named on hover. */
  nextTitle?: string | null;
}

/** Previous, play/pause and next, for whichever player they drive. */
export function TransportButtons({ size, playing, loading, onPrevious, onTogglePlay, onNext, nextTitle }: TransportButtonsProps) {
  const sizes = SIZES[size];
  const skipClass = `grid ${sizes.skip} place-items-center rounded-full text-chrome-neutral-100 transition-transform duration-200 ease-out hover:scale-110`;
  return (
    <div className={`flex items-center ${sizes.gap}`}>
      <HapticButton onClick={onPrevious} aria-label={getString("music_previous")} className={skipClass}>
        <SkipBack className={sizes.skipIcon} fill="currentColor" />
      </HapticButton>
      <HapticButton
        onClick={onTogglePlay}
        aria-label={getString(playing ? "music_pause" : "music_play")}
        className={`grid ${sizes.play} place-items-center rounded-full bg-[var(--color-primary)] text-[var(--color-on-primary)] transition-transform duration-200 ease-out hover:scale-105`}
      >
        {loading ? (
          <Loader2 className={`${sizes.playIcon} animate-spin`} />
        ) : playing ? (
          <Pause className={sizes.playIcon} fill="currentColor" />
        ) : (
          <Play className={`${sizes.playIcon} translate-x-px`} fill="currentColor" />
        )}
      </HapticButton>
      <HapticButton
        onClick={onNext}
        aria-label={getString("music_next")}
        title={nextTitle ? `${getString("music_up_next")}: ${nextTitle}` : undefined}
        className={skipClass}
      >
        <SkipForward className={sizes.skipIcon} fill="currentColor" />
      </HapticButton>
    </div>
  );
}

interface PlayerTransportProps {
  size?: "lg" | "md";
  /** Shuffle and repeat at the ends of the row. */
  withModes?: boolean;
}

/** Previous, play/pause and next for the full player, with shuffle and repeat when asked. */
export function PlayerTransport({ size = "lg", withModes = true }: PlayerTransportProps) {
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const loading = useMusicPlayerStore((s) => s.isBuffering || s.loadingStreamId !== null);
  const isShuffle = useMusicPlayerStore((s) => s.isShuffle);
  const repeatMode = useMusicPlayerStore((s) => s.repeatMode);
  const togglePlay = useMusicPlayerStore((s) => s.togglePlay);
  const next = useMusicPlayerStore((s) => s.next);
  const previous = useMusicPlayerStore((s) => s.previous);
  const toggleShuffle = useMusicPlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = useMusicPlayerStore((s) => s.cycleRepeat);
  // Hovering Next names the song it will play, in place of Android's press-and-hold preview.
  const nextTitle = useMusicPlayerStore((s) => s.queue[upcomingIndex(s)]?.title ?? null);
  const center = (
    <TransportButtons
      size={size}
      playing={isPlaying}
      loading={loading}
      onPrevious={previous}
      onTogglePlay={togglePlay}
      onNext={next}
      nextTitle={nextTitle}
    />
  );

  if (!withModes) return center;

  return (
    <div className="flex w-full items-center justify-between">
      <HapticButton
        onClick={toggleShuffle}
        aria-label={getString("music_shuffle")}
        aria-pressed={isShuffle}
        className={isShuffle ? SIDE_ACTIVE : SIDE_IDLE}
      >
        <Shuffle className="h-5 w-5" />
      </HapticButton>
      {center}
      <HapticButton
        onClick={cycleRepeat}
        aria-label={repeatMode === "one" ? getString("music_repeat_one") : getString("music_repeat")}
        aria-pressed={repeatMode !== "none"}
        className={repeatMode !== "none" ? SIDE_ACTIVE : SIDE_IDLE}
      >
        {repeatMode === "one" ? <Repeat1 className="h-5 w-5" /> : <Repeat className="h-5 w-5" />}
      </HapticButton>
    </div>
  );
}
