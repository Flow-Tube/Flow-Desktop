import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  ListMusic,
  Mic2,
  SlidersHorizontal,
  Maximize2,
  Loader2,
  X,
} from "lucide-react";

import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { useMusicPlayerError } from "../../lib/useMusicPlayerError";
import { getString } from "../../lib/i18n/index";
import { artistsText } from "../../lib/musicFormat";
import { PlayerErrorState } from "../ui/PlayerErrorState";
import { HapticButton } from "./HapticButton";
import { MusicArtwork } from "./MusicArtwork";
import { MusicScrubber } from "./MusicScrubber";
import { EqPanel } from "./EqPanel";
import { VolumePopover } from "./VolumePopover";

const GHOST = "grid h-9 w-9 place-items-center rounded-full transition-colors duration-200 ease-out";
const GHOST_IDLE = `${GHOST} text-chrome-neutral-400 hover:text-chrome-neutral-100`;
const GHOST_ACTIVE = `${GHOST} text-[var(--color-primary)]`;

export function GlobalMusicDock() {
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const viewState = useMusicPlayerStore((s) => s.viewState);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const isBuffering = useMusicPlayerStore((s) => s.isBuffering);
  const loadingStreamId = useMusicPlayerStore((s) => s.loadingStreamId);
  const eqEnabled = useMusicPlayerStore((s) => s.eqEnabled);
  const isShuffle = useMusicPlayerStore((s) => s.isShuffle);
  const repeatMode = useMusicPlayerStore((s) => s.repeatMode);
  const isMuted = useMusicPlayerStore((s) => s.isMuted);
  const volume = useMusicPlayerStore((s) => s.volume);

  const togglePlay = useMusicPlayerStore((s) => s.togglePlay);
  const next = useMusicPlayerStore((s) => s.next);
  const previous = useMusicPlayerStore((s) => s.previous);
  const toggleShuffle = useMusicPlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = useMusicPlayerStore((s) => s.cycleRepeat);
  const openOverlay = useMusicPlayerStore((s) => s.openOverlay);
  const dismiss = useMusicPlayerStore((s) => s.dismiss);

  const { errorInfo, onRetry, onCopyLogs, onOpenInBrowser } = useMusicPlayerError();

  const [popover, setPopover] = useState<null | "eq" | "vol">(null);

  const loading = isBuffering || loadingStreamId !== null;
  const muted = isMuted || volume === 0;

  return (
    <AnimatePresence>
      {currentTrack && viewState === "dock" && (
        <motion.div
          key="music-dock"
          initial={{ y: 96, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 96, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 38, mass: 0.9 }}
          className="group fixed bottom-6 left-1/2 z-50 h-16 w-[90%] max-w-5xl -translate-x-1/2"
        >
          {/* Dismiss — appears on hover at the corner. */}
          <HapticButton
            onClick={dismiss}
            aria-label={getString("music_dismiss")}
            className="absolute -right-2.5 -top-2.5 z-20 grid h-6 w-6 place-items-center rounded-full border border-chrome-neutral-700 bg-surface-container-highest text-chrome-neutral-300 opacity-0 transition-opacity duration-200 ease-out hover:text-chrome-neutral-100 group-hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </HapticButton>

          {/* Playback failure — floats above the pill so transport stays usable. */}
          {errorInfo && (
            <div className="absolute inset-x-0 bottom-full mb-3">
              <PlayerErrorState
                variant="compact"
                error={errorInfo}
                onRetry={onRetry}
                onCopyLogs={onCopyLogs}
                onOpenInBrowser={onOpenInBrowser}
              />
            </div>
          )}

          {/* The pill (clips the edge progress bar to the rounded corners). */}
          <div className="relative flex h-full items-center overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface-container-high px-4">
            {/* LEFT — artwork + meta (click to expand) */}
            <div className="flex w-1/3 min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => openOverlay("full")}
                aria-label={getString("music_expand")}
                className="group/art flex min-w-0 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              >
                <MusicArtwork
                  src={currentTrack.thumbnail}
                  alt={currentTrack.title}
                  layoutId="album-art"
                  loading={loading}
                  className="h-10 w-10 shrink-0 rounded-md ring-1 ring-chrome-neutral-800/60 transition-transform duration-200 ease-out group-hover/art:scale-[1.04]"
                />
                <div className="min-w-0">
                  <div className="line-clamp-1 text-sm font-medium text-chrome-neutral-100">
                    {currentTrack.title}
                  </div>
                  <div className="line-clamp-1 text-xs text-chrome-neutral-400">
                    {artistsText(currentTrack.artists)}
                  </div>
                </div>
              </button>
            </div>

            {/* CENTER — transport */}
            <div className="flex w-1/3 items-center justify-center gap-5">
              <HapticButton
                onClick={toggleShuffle}
                aria-label={getString("music_shuffle")}
                aria-pressed={isShuffle}
                className={isShuffle ? GHOST_ACTIVE : GHOST_IDLE}
              >
                <Shuffle className="h-[18px] w-[18px]" />
              </HapticButton>

              <HapticButton
                onClick={previous}
                aria-label={getString("music_previous")}
                className="grid h-9 w-9 place-items-center rounded-full text-chrome-neutral-200 transition-colors duration-200 ease-out hover:text-chrome-neutral-100"
              >
                <SkipBack className="h-5 w-5" fill="currentColor" />
              </HapticButton>

              <HapticButton
                onClick={togglePlay}
                aria-label={getString(isPlaying ? "music_pause" : "music_play")}
                className="grid h-11 w-11 place-items-center rounded-full bg-[var(--color-primary)] text-[var(--color-on-primary)] transition-transform duration-200 ease-out hover:scale-105"
              >
                {loading ? (
                  <Loader2 className="h-7 w-7 animate-spin" />
                ) : isPlaying ? (
                  <Pause className="h-7 w-7" fill="currentColor" />
                ) : (
                  <Play className="h-7 w-7 translate-x-px" fill="currentColor" />
                )}
              </HapticButton>

              <HapticButton
                onClick={next}
                aria-label={getString("music_next")}
                className="grid h-9 w-9 place-items-center rounded-full text-chrome-neutral-200 transition-colors duration-200 ease-out hover:text-chrome-neutral-100"
              >
                <SkipForward className="h-5 w-5" fill="currentColor" />
              </HapticButton>

              <HapticButton
                onClick={cycleRepeat}
                aria-label={
                  repeatMode === "one" ? getString("music_repeat_one") : getString("music_repeat")
                }
                aria-pressed={repeatMode !== "none"}
                className={repeatMode !== "none" ? GHOST_ACTIVE : GHOST_IDLE}
              >
                {repeatMode === "one" ? (
                  <Repeat1 className="h-[18px] w-[18px]" />
                ) : (
                  <Repeat className="h-[18px] w-[18px]" />
                )}
              </HapticButton>
            </div>

            {/* RIGHT — secondary actions */}
            <div className="flex w-1/3 items-center justify-end gap-4">
              <HapticButton
                onClick={() => setPopover((p) => (p === "vol" ? null : "vol"))}
                aria-label={getString("music_volume")}
                aria-pressed={popover === "vol"}
                className={popover === "vol" ? `${GHOST} text-chrome-neutral-100` : GHOST_IDLE}
              >
                {muted ? <VolumeX className="h-[18px] w-[18px]" /> : <Volume2 className="h-[18px] w-[18px]" />}
              </HapticButton>

              <HapticButton
                onClick={() => openOverlay("queue")}
                aria-label={getString("music_queue")}
                className={GHOST_IDLE}
              >
                <ListMusic className="h-[18px] w-[18px]" />
              </HapticButton>

              <HapticButton
                onClick={() => openOverlay("lyrics")}
                aria-label={getString("music_lyrics")}
                className={GHOST_IDLE}
              >
                <Mic2 className="h-[18px] w-[18px]" />
              </HapticButton>

              <HapticButton
                onClick={() => setPopover((p) => (p === "eq" ? null : "eq"))}
                aria-label={getString("music_equalizer")}
                aria-pressed={popover === "eq"}
                className={popover === "eq" || eqEnabled ? GHOST_ACTIVE : GHOST_IDLE}
              >
                <SlidersHorizontal className="h-[18px] w-[18px]" />
              </HapticButton>

              <HapticButton
                onClick={() => openOverlay("full")}
                aria-label={getString("music_expand")}
                className={GHOST_IDLE}
              >
                <Maximize2 className="h-[18px] w-[18px]" />
              </HapticButton>
            </div>

            {/* EDGE PROGRESS — pinned to the bottom of the pill */}
            <MusicScrubber variant="edge" className="absolute inset-x-0 bottom-0" />
          </div>

          {/* Popovers — rendered outside the clipped pill so they aren't cut off. */}
          <div className="absolute bottom-full right-2 mb-3">
            <EqPanel
              open={popover === "eq"}
              onClose={() => setPopover(null)}
              placement="top"
            />
          </div>
          <div className="absolute bottom-full right-2 mb-3">
            <VolumePopover open={popover === "vol"} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
