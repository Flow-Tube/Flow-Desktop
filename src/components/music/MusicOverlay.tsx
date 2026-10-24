import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ListMusic, Mic2, Minimize2, RefreshCw, SlidersHorizontal, Volume2, VolumeX } from "lucide-react";

import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { useMusicPlayerError } from "../../lib/useMusicPlayerError";
import { useCoverAppContent } from "../../lib/useCoverAppContent";
import { useMusicPlayerKeyboard } from "../../lib/useMusicPlayerKeyboard";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { volumeAfterWheel } from "../../lib/musicPlayerKeys";
import { PlayerErrorState } from "../ui/PlayerErrorState";
import { getString } from "../../lib/i18n/index";
import { HapticButton } from "./HapticButton";
import { MusicScrubber } from "./MusicScrubber";
import { MusicQueuePane } from "./MusicQueuePane";
import { MusicLyrics } from "./MusicLyrics";
import { AmbientBackdrop } from "./AmbientBackdrop";
import { EqPanel } from "./EqPanel";
import { useEqActive } from "../../lib/audio/eq/useEqualizer";
import { VolumePopover } from "./VolumePopover";
import { LAYOUT_SPRING, NowPlayingColumn } from "./player/NowPlayingColumn";
import { PlayerSidePane, type SidePaneTab } from "./player/PlayerSidePane";
import { PlayerTransport } from "./player/PlayerTransport";
import { useLyricsStore } from "../../store/useLyricsStore";
import { useArtworkSwatches } from "../../lib/useArtworkSwatches";
import { useFullPlayerColors } from "../../lib/usePlayerColors";
import { upgradeMusicImageUrl } from "../../lib/thumbnails";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";

const TOP_BTN =
  "grid h-10 w-10 place-items-center rounded-full text-chrome-neutral-300 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100";
const TOP_BTN_ACTIVE =
  "grid h-10 w-10 place-items-center rounded-full bg-surface-container-high text-[var(--color-primary)] transition-colors duration-200 ease-out";

/** From this width the song keeps its column and Up next or the lyrics sit beside it, as on Android tablets. */
const WIDE_QUERY = "(min-width: 1100px)";

export function MusicOverlay() {
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const viewState = useMusicPlayerStore((s) => s.viewState);
  const eqEnabled = useEqActive();
  const volume = useMusicPlayerStore((s) => s.volume);
  const isMuted = useMusicPlayerStore((s) => s.isMuted);
  const queueSource = useMusicPlayerStore((s) => s.queueSource);
  const setVolume = useMusicPlayerStore((s) => s.setVolume);
  const setViewState = useMusicPlayerStore((s) => s.setViewState);
  const closeOverlay = useMusicPlayerStore((s) => s.closeOverlay);

  const musicError = useMusicPlayerError();
  const [eqOpen, setEqOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [lyricsExpanded, setLyricsExpanded] = useState(false);
  const wide = useMediaQuery(WIDE_QUERY);
  const open = currentTrack !== null && viewState !== "dock";
  const isQueue = viewState === "queue";
  const isLyrics = viewState === "lyrics";
  /*
    Sample the URL the artwork actually renders, not the raw field: YouTube
    Music hands back protocol-relative and unsized image URLs, and a bare `//`
    src resolves against the Tauri page origin as http, which `img-src https:`
    then blocks — the load fails and the accent silently falls back to the
    theme colour. Going through the same helpers as `MusicArtwork` normalises
    the URL and reuses its cache entry instead of fetching a second copy.
  */
  const accentSrc = useProxiedImageUrl(upgradeMusicImageUrl(currentTrack?.thumbnail));
  const playerColors = useFullPlayerColors(useArtworkSwatches(accentSrc));

  // The page only goes away once the fade-in has finished covering it.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (!open) setEntered(false);
  }, [open]);
  useCoverAppContent(open && entered);

  useEffect(() => {
    if (!isLyrics) setLyricsExpanded(false);
  }, [isLyrics]);

  // Focus moves into the player when it opens and back to where it was when it closes.
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => previous?.focus({ preventScroll: true });
  }, [open]);

  const onEscape = useCallback(() => {
    if (volumeOpen) setVolumeOpen(false);
    else if (eqOpen) setEqOpen(false);
    else if (wide && lyricsExpanded) setLyricsExpanded(false);
    else return false;
    return true;
  }, [volumeOpen, eqOpen, wide, lyricsExpanded]);
  useMusicPlayerKeyboard(open, onEscape);

  const fullBleedLyrics = isLyrics && (!wide || lyricsExpanded);
  const sideTab: SidePaneTab = isLyrics ? "lyrics" : "queue";
  const muted = isMuted || volume === 0;

  // Android draws the lyrics in the player's primary, checked against the surface behind them.
  const lyricsView = (variant: "full" | "pane", className: string) => (
    <MusicLyrics
      track={currentTrack}
      variant={variant}
      accent={playerColors.colors.roles.primary}
      backdrop={playerColors.colors.roles.surface}
      active
      className={className}
    />
  );

  return (
    <AnimatePresence>
      {open && currentTrack && (
        <motion.div
          key="music-overlay"
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={currentTrack.title}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          onAnimationComplete={(definition) => {
            // Also fires when the exit fade ends; only the fade-in counts.
            if ((definition as { opacity?: number }).opacity === 1) setEntered(true);
          }}
          className="fixed inset-x-0 bottom-0 top-[var(--app-titlebar-height)] z-[60] flex flex-col overflow-hidden bg-[var(--player-ground)] outline-none"
          style={playerColors.rootStyle}
        >
          <AmbientBackdrop imageSrc={accentSrc} style={playerColors.style} artworkAtStart={wide} />

          {/* TOP BAR */}
          <div className="absolute top-0 z-20 grid w-full grid-cols-[1fr_auto_1fr] items-center gap-4 p-6">
            <HapticButton
              onClick={closeOverlay}
              aria-label={getString("music_collapse")}
              className={`${TOP_BTN} justify-self-start`}
            >
              <ChevronDown className="h-6 w-6" />
            </HapticButton>

            <p className="line-clamp-1 max-w-md text-center text-sm text-chrome-neutral-400">
              {queueSource ? (
                <>
                  {getString("playing_from")} <span className="font-medium text-chrome-neutral-200">{queueSource}</span>
                </>
              ) : null}
            </p>

            <div className="relative flex items-center gap-1 justify-self-end">
              {isLyrics && (
                <HapticButton onClick={() => useLyricsStore.getState().refresh()} aria-label={getString("music_refresh_lyrics")} className={TOP_BTN}>
                  <RefreshCw className="h-5 w-5" />
                </HapticButton>
              )}
              {wide && lyricsExpanded && (
                <HapticButton
                  onClick={() => setLyricsExpanded(false)}
                  aria-label={getString("music_lyrics_back_to_pane")}
                  title={getString("music_lyrics_back_to_pane")}
                  className={TOP_BTN}
                >
                  <Minimize2 className="h-5 w-5" />
                </HapticButton>
              )}

              <HapticButton
                onClick={() => setViewState(isQueue ? "full" : "queue")}
                aria-label={getString("music_queue")}
                aria-pressed={wide ? sideTab === "queue" && !fullBleedLyrics : isQueue}
                className={(wide ? sideTab === "queue" && !fullBleedLyrics : isQueue) ? TOP_BTN_ACTIVE : TOP_BTN}
              >
                <ListMusic className="h-5 w-5" />
              </HapticButton>

              <HapticButton
                onClick={() => setViewState(isLyrics ? "full" : "lyrics")}
                aria-label={getString("music_lyrics")}
                aria-pressed={isLyrics}
                className={isLyrics ? TOP_BTN_ACTIVE : TOP_BTN}
              >
                <Mic2 className="h-5 w-5" />
              </HapticButton>

              <div className="relative">
                <HapticButton
                  onClick={() => setVolumeOpen((v) => !v)}
                  onWheel={(event) => setVolume(volumeAfterWheel(volume, event.deltaY))}
                  aria-label={getString("music_volume")}
                  aria-pressed={volumeOpen}
                  className={volumeOpen ? TOP_BTN_ACTIVE : TOP_BTN}
                >
                  {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                </HapticButton>
                <div className="absolute right-0 top-full mt-2">
                  <VolumePopover open={volumeOpen} />
                </div>
              </div>

              <HapticButton
                onClick={() => setEqOpen((v) => !v)}
                aria-label={getString("music_equalizer")}
                aria-pressed={eqOpen}
                className={eqOpen || eqEnabled ? TOP_BTN_ACTIVE : TOP_BTN}
              >
                <SlidersHorizontal className="h-5 w-5" />
              </HapticButton>

              {/* EQ opens BELOW the top bar so it stays in frame */}
              <div className="absolute right-0 top-full mt-2">
                <EqPanel open={eqOpen} onClose={() => setEqOpen(false)} placement="bottom" />
              </div>
            </div>
          </div>

          {/* Playback failure banner — floats below the top bar across all sub-views. */}
          {musicError.errorInfo && (
            <div className="pointer-events-none absolute left-1/2 top-20 z-30 w-full max-w-xl -translate-x-1/2 px-6">
              <div className="pointer-events-auto">
                <PlayerErrorState
                  variant="compact"
                  error={musicError.errorInfo}
                  onRetry={musicError.onRetry}
                  onCopyLogs={musicError.onCopyLogs}
                  onOpenInBrowser={musicError.onOpenInBrowser}
                />
              </div>
            </div>
          )}

          {/* MAIN */}
          {fullBleedLyrics ? (
            <>
              {lyricsView("full", "absolute inset-0 z-10")}
              <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-4 bg-linear-to-t from-[color-mix(in_srgb,var(--player-ground)_90%,transparent)] via-[color-mix(in_srgb,var(--player-ground)_50%,transparent)] to-transparent px-6 pb-10 pt-24">
                <div className="w-full max-w-2xl">
                  <MusicScrubber size="lg" showTimes countdown expressive />
                </div>
                <PlayerTransport size="md" withModes={false} />
              </div>
            </>
          ) : (
            <motion.div
              layout
              transition={LAYOUT_SPRING}
              className="relative z-10 flex min-h-0 flex-1 items-stretch justify-center gap-8 px-8 pb-10 pt-24"
            >
              <div className={`flex min-h-0 min-w-0 justify-center ${wide ? "flex-1" : isQueue ? "w-1/2" : "w-full max-w-2xl"}`}>
                <NowPlayingColumn
                  track={currentTrack}
                  compact={!wide && isQueue}
                  artworkHidden={playerColors.style === "immersive"}
                  onOpenEqualizer={() => setEqOpen(true)}
                />
              </div>

              {wide ? (
                <div className="flex min-h-0 w-[min(460px,40%)] shrink-0">
                  <PlayerSidePane
                    tab={sideTab}
                    onTabChange={(tab) => setViewState(tab === "lyrics" ? "lyrics" : "queue")}
                    onExpandLyrics={() => setLyricsExpanded(true)}
                  >
                    {sideTab === "lyrics" ? lyricsView("pane", "absolute inset-0") : <MusicQueuePane />}
                  </PlayerSidePane>
                </div>
              ) : (
                <AnimatePresence mode="popLayout">
                  {isQueue && (
                    <motion.div
                      key="queue-pane"
                      initial={{ opacity: 0, x: 48 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 48 }}
                      transition={LAYOUT_SPRING}
                      className="flex min-h-0 w-1/2 flex-col rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-4"
                    >
                      <MusicQueuePane />
                    </motion.div>
                  )}
                </AnimatePresence>
              )}
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
