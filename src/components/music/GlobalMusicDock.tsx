import { useState } from "react";
import { AnimatePresence, motion, useTransform } from "framer-motion";
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
  Loader2,
  X,
} from "lucide-react";

import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { useMusicPlayerError } from "../../lib/useMusicPlayerError";
import { getString } from "../../lib/i18n/index";
import { artistsText } from "../../lib/musicFormat";
import { PlayerErrorState } from "../ui/PlayerErrorState";
import { HapticButton } from "./HapticButton";
import { MusicCardMenu, useMusicContextMenu } from "./MusicCardMenu";
import { useNowPlayingMenuActions } from "./useNowPlayingMenuActions";
import { MusicArtwork } from "./MusicArtwork";
import { PlayingWave } from "./PlayingWave";
import { MusicScrubber } from "./MusicScrubber";
import { EqPanel } from "./EqPanel";
import { useEqActive } from "../../lib/audio/eq/useEqualizer";
import { VolumePopover } from "./VolumePopover";
import { useArtworkSwatches } from "../../lib/useArtworkSwatches";
import { useDockToggleColors } from "../../lib/usePlayerColors";
import { volumeAfterWheel } from "../../lib/musicPlayerKeys";
import { upgradeMusicImageUrl } from "../../lib/thumbnails";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { dockOpacity, registerSheetDock, sheetProgress } from "../../lib/musicSheet";
import { useSheetDrag } from "../../lib/useSheetDrag";
import { useRemoteActive } from "../../lib/live/usePlayOn";
import { PlayOnButton } from "../playon/PlayOnButton";

const GHOST = "grid h-9 w-9 place-items-center rounded-full transition-colors duration-200 ease-out";
/** The dock's icon buttons, also used by the remote dock. */
export const GHOST_IDLE = `${GHOST} text-chrome-neutral-400 hover:text-chrome-neutral-100`;

export function GlobalMusicDock() {
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const viewState = useMusicPlayerStore((s) => s.viewState);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const isBuffering = useMusicPlayerStore((s) => s.isBuffering);
  const loadingStreamId = useMusicPlayerStore((s) => s.loadingStreamId);
  const eqEnabled = useEqActive();
  const isShuffle = useMusicPlayerStore((s) => s.isShuffle);
  const repeatMode = useMusicPlayerStore((s) => s.repeatMode);
  const isMuted = useMusicPlayerStore((s) => s.isMuted);
  const volume = useMusicPlayerStore((s) => s.volume);
  const setVolume = useMusicPlayerStore((s) => s.setVolume);

  const togglePlay = useMusicPlayerStore((s) => s.togglePlay);
  const next = useMusicPlayerStore((s) => s.next);
  const previous = useMusicPlayerStore((s) => s.previous);
  const toggleShuffle = useMusicPlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = useMusicPlayerStore((s) => s.cycleRepeat);
  const openOverlay = useMusicPlayerStore((s) => s.openOverlay);
  const dismiss = useMusicPlayerStore((s) => s.dismiss);

  const { errorInfo, onRetry, onCopyLogs, onOpenInBrowser } = useMusicPlayerError();

  const [popover, setPopover] = useState<null | "eq" | "vol">(null);
  const menu = useMusicContextMenu(Boolean(currentTrack));
  const menuActions = useNowPlayingMenuActions(currentTrack);

  // Same artwork URL the overlay samples, so this reads a warm cache entry.
  const accentSrc = useProxiedImageUrl(upgradeMusicImageUrl(currentTrack?.thumbnail));
  const accentActive = useDockToggleColors(useArtworkSwatches(accentSrc));

  const loading = isBuffering || loadingStreamId !== null;
  const muted = isMuted || volume === 0;

  // The dock stays under the full player, so the player can grow out of it and sink back into it.
  const docked = viewState === "dock";
  const sheetDrag = useSheetDrag();
  const opacity = useTransform(sheetProgress, dockOpacity);
  // While another device plays and this one doesn't, the remote dock takes this place.
  const remote = useRemoteActive();

  return (
    <AnimatePresence>
      {currentTrack && !remote && (
        <motion.div
          key="music-dock"
          initial={{ y: 96, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 96, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 38, mass: 0.9 }}
          inert={!docked}
          className="group fixed bottom-6 left-1/2 z-50 h-[72px] w-[90%] max-w-5xl -translate-x-1/2"
        >
          <motion.div style={{ opacity }} className="h-full">
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

            {/* The pill (clips the edge progress bar to the rounded corners). Drag it up to open the player. */}
            <div
              ref={registerSheetDock}
              {...sheetDrag}
              className="relative flex h-full touch-none select-none items-center overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface-container-high pl-3 pr-4"
            >
              {/* Grab handle, shown on hover so the drag up is discoverable. */}
              <span
                aria-hidden
                className="pointer-events-none absolute left-1/2 top-1.5 h-1 w-8 -translate-x-1/2 rounded-full bg-chrome-neutral-600 opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100"
              />

              {/* LEFT — artwork + meta (click to expand) */}
              <div className="flex w-1/3 min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => openOverlay("full")}
                  onContextMenu={menu.openMenuFromContext}
                  aria-label={getString("music_expand")}
                  className="group/art flex min-w-0 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  <div className="relative h-12 w-12 shrink-0">
                    <MusicArtwork
                      src={currentTrack.thumbnail}
                      alt={currentTrack.title}
                      loading={loading}
                      className="h-12 w-12 rounded-xl ring-1 ring-chrome-neutral-800/60 transition-transform duration-200 ease-out group-hover/art:scale-[1.04]"
                    />
                    {isPlaying && !loading && (
                      <span className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl bg-chrome-black/35 text-chrome-white">
                        <PlayingWave className="h-4" />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="line-clamp-1 text-[15px] font-semibold tracking-tight text-chrome-neutral-100">
                      {currentTrack.title}
                    </div>
                    <div className="mt-0.5 line-clamp-1 text-[13px] font-medium text-chrome-neutral-400">
                      {artistsText(currentTrack.artists)}
                    </div>
                  </div>
                </button>
                <MusicCardMenu
                  actions={menuActions}
                  anchor={menu.anchor}
                  onClose={menu.closeMenu}
                  show={menu.showMenu}
                />
              </div>

              {/* CENTER — transport */}
              <div className="flex w-1/3 items-center justify-center gap-5">
                <HapticButton
                  onClick={toggleShuffle}
                  aria-label={getString("music_shuffle")}
                  aria-pressed={isShuffle}
                  className={isShuffle ? GHOST : GHOST_IDLE}
                  style={isShuffle ? accentActive : undefined}
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
                  className="grid h-11 w-11 place-items-center rounded-full bg-[var(--color-primary)] text-[var(--color-on-primary)] transition-transform duration-200 ease-out hover:scale-105 active:scale-90"
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
                  className={repeatMode !== "none" ? GHOST : GHOST_IDLE}
                  style={repeatMode !== "none" ? accentActive : undefined}
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
                  data-sheet-drag-ignore
                  onClick={() => setPopover((p) => (p === "vol" ? null : "vol"))}
                  onWheel={(event) => setVolume(volumeAfterWheel(volume, event.deltaY))}
                  aria-label={getString("music_volume")}
                  aria-pressed={popover === "vol"}
                  className={popover === "vol" ? `${GHOST} text-chrome-neutral-100` : GHOST_IDLE}
                >
                  {muted ? <VolumeX className="h-[18px] w-[18px]" /> : <Volume2 className="h-[18px] w-[18px]" />}
                </HapticButton>

                <PlayOnButton className={GHOST_IDLE} />

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
                  className={popover === "eq" || eqEnabled ? GHOST : GHOST_IDLE}
                  style={popover === "eq" || eqEnabled ? accentActive : undefined}
                >
                  <SlidersHorizontal className="h-[18px] w-[18px]" />
                </HapticButton>
              </div>

              {/* EDGE PROGRESS — pinned to the bottom of the pill */}
              <div data-sheet-drag-ignore className="absolute inset-x-0 bottom-0">
                <MusicScrubber variant="edge" />
              </div>
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
        </motion.div>
      )}
    </AnimatePresence>
  );
}
