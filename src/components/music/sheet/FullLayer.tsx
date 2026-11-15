import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useTransform, type MotionValue } from "framer-motion";
import { ChevronDown, ListMusic, Mic2, Minimize2, SlidersHorizontal, Volume2, VolumeX } from "lucide-react";

import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import { useMusicPlayerError } from "../../../lib/useMusicPlayerError";
import { useCoverAppContent } from "../../../lib/useCoverAppContent";
import { useMusicPlayerKeyboard } from "../../../lib/useMusicPlayerKeyboard";
import { useMediaQuery } from "../../../lib/useMediaQuery";
import { useBoolPref } from "../../../lib/usePreference";
import { SETTINGS } from "../../../lib/settings/schema";
import { useMusicWheelVolume } from "../../../lib/useMusicWheelVolume";
import { useVolumeFeedback } from "../../../lib/useVolumeFeedback";
import { VolumeFeedbackPill } from "../../ui/VolumeFeedbackPill";
import { PlayerErrorState } from "../../ui/PlayerErrorState";
import { getString } from "../../../lib/i18n/index";
import { HapticButton } from "../HapticButton";
import { MusicScrubber } from "../MusicScrubber";
import { MusicQueuePane } from "../MusicQueuePane";
import { LyricsActionsMenu, MusicLyrics } from "../MusicLyrics";
import { AmbientBackdrop } from "../AmbientBackdrop";
import { LyricsCoverBackground } from "../lyrics/LyricsCoverBackground";
import { useLyricsBackground, useLyricsCover } from "../../../lib/lyrics/useLyricsCover";
import { EqPanel } from "../EqPanel";
import { useEqActive } from "../../../lib/audio/eq/useEqualizer";
import { VolumePopover } from "../VolumePopover";
import { PlayOnButton } from "../../playon/PlayOnButton";
import { LAYOUT_SPRING, NowPlayingColumn } from "../player/NowPlayingColumn";
import { PlayerSidePane, type SidePaneTab } from "../player/PlayerSidePane";
import { PlayerTransport } from "../player/PlayerTransport";
import { GROUP_BUTTON, GROUP_BUTTON_ACTIVE, GroupItem, NO_TAP_SCALE, PlayerButtonGroup } from "../player/PlayerButtonGroup";
import { useArtworkSwatches } from "../../../lib/useArtworkSwatches";
import { useFullPlayerColors } from "../../../lib/usePlayerColors";
import { coverSurfaceVariables } from "../../../lib/playerColors";
import { upgradeMusicImageUrl } from "../../../lib/thumbnails";
import { useProxiedImageUrl } from "../../../lib/useProxiedImageUrl";
import { contentOpacity, contentRise, sheetOpacity, sheetProgress } from "../../../lib/musicSheet";
import { usePlayerDrag } from "../../../lib/useSheetDrag";

const rgbCss = ({ r, g, b }: { r: number; g: number; b: number }) => `rgb(${r} ${g} ${b})`;

/** From this width the song keeps its column and Up next or the lyrics sit beside it, as on Android tablets. */
const WIDE_QUERY = "(min-width: 1100px)";

/**
 * The full player, laid out once at the window's size inside the sheet's card and moved by
 * `offsetX`/`offsetY` so it stays still on screen while the card around it grows and shrinks.
 */
export function FullLayer({ offsetX, offsetY }: { offsetX: MotionValue<number>; offsetY: MotionValue<number> }) {
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const viewState = useMusicPlayerStore((s) => s.viewState);
  const eqEnabled = useEqActive();
  const volume = useMusicPlayerStore((s) => s.volume);
  const isMuted = useMusicPlayerStore((s) => s.isMuted);
  const queueSource = useMusicPlayerStore((s) => s.queueSource);
  const { feedback: volumeFeedback, show: showVolumeFeedback } = useVolumeFeedback();
  const volumeWheelRef = useMusicWheelVolume<HTMLButtonElement>({ onFeedback: showVolumeFeedback });
  const setViewState = useMusicPlayerStore((s) => s.setViewState);
  const closeOverlay = useMusicPlayerStore((s) => s.closeOverlay);

  const musicError = useMusicPlayerError();
  const [eqOpen, setEqOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [lyricsExpanded, setLyricsExpanded] = useState(false);
  const wide = useMediaQuery(WIDE_QUERY);
  const [paneVisible, setPaneVisible] = useBoolPref(SETTINGS.MUSIC_SIDE_PANE_VISIBLE);
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

  const dialogRef = useRef<HTMLDivElement>(null);
  const groundOpacity = useTransform(sheetProgress, sheetOpacity);
  const innerOpacity = useTransform(sheetProgress, contentOpacity);
  const innerRise = useTransform(sheetProgress, contentRise);
  const drag = usePlayerDrag();

  // The page only goes away once the player has finished covering it.
  const [entered, setEntered] = useState(() => sheetProgress.get() >= 1);
  useMotionValueEvent(sheetProgress, "change", (progress) => setEntered(progress >= 1));
  useCoverAppContent(open && entered);

  useEffect(() => {
    if (!isLyrics) setLyricsExpanded(false);
  }, [isLyrics]);

  // Focus moves into the player when it opens and back to where it was when it closes.
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
  const showPane = wide && paneVisible;
  const lyricsBackground = useLyricsBackground();
  // The cover's colours are only worked out while lyrics drawn on them are on screen.
  const coverBehindLyrics = lyricsBackground !== "player" && isLyrics && (fullBleedLyrics || showPane);
  const lyricsCover = useLyricsCover(accentSrc, open && coverBehindLyrics);
  const lyricsOnCover = lyricsBackground !== "player" ? lyricsCover : null;
  const [paneCoverColors] = useBoolPref(SETTINGS.MUSIC_SIDE_PANE_COVER_COLORS);
  const paneSurface = useMemo(
    () => (paneCoverColors ? (coverSurfaceVariables(playerColors.colors) as CSSProperties) : undefined),
    [paneCoverColors, playerColors.colors],
  );
  // Immersive's cover sits beside the side pane, and moves behind the song once the pane is hidden.
  const artworkPlacement = !wide ? "top" : showPane && !fullBleedLyrics ? "start" : "center";

  // Asking for the queue or the lyrics from elsewhere (a key, the dock) brings a hidden pane back.
  // It follows the view only, so hiding the pane is never undone by the pane's own state.
  useEffect(() => {
    if (wide && (isQueue || isLyrics) && !paneVisible) setPaneVisible(true);
  }, [wide, viewState]);

  // Hiding leaves the plain player, so the queue and lyrics buttons read as off.
  const hidePane = () => {
    setPaneVisible(false);
    setViewState("full");
  };
  const queueShown = wide ? showPane && sideTab === "queue" && !fullBleedLyrics : isQueue;
  const lyricsShown = wide ? isLyrics && (fullBleedLyrics || showPane) : isLyrics;
  const onQueueButton = () => {
    if (!wide) setViewState(isQueue ? "full" : "queue");
    else if (queueShown) hidePane();
    else {
      setPaneVisible(true);
      setViewState("queue");
    }
  };
  const onLyricsButton = () => {
    if (!wide || fullBleedLyrics) setViewState(isLyrics ? "full" : "lyrics");
    else if (lyricsShown) hidePane();
    else {
      setPaneVisible(true);
      setViewState("lyrics");
    }
  };
  const muted = isMuted || volume === 0;

  // Android draws the lyrics in the player's primary, checked against the surface behind them.
  const lyricsView = (variant: "full" | "pane", className: string) => (
    <div data-sheet-drag-ignore className={className}>
      <MusicLyrics
        track={currentTrack}
        variant={variant}
        accent={playerColors.colors.roles.primary}
        backdrop={lyricsOnCover ? lyricsOnCover.backdrop : playerColors.colors.roles.surface}
        active
        className="h-full w-full"
      />
    </div>
  );

  if (!currentTrack) return null;

  return (
    <motion.div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={currentTrack.title}
      aria-hidden={!open}
      // While the dock is dragged or the player sinks, the pointer belongs to the dock.
      className={`absolute top-0 flex h-[calc(100vh-var(--app-titlebar-height))] w-screen flex-col overflow-hidden bg-[var(--player-ground)] outline-none ${open ? "" : "pointer-events-none"}`}
      // Screen coordinates, the same in either direction: the card it sits in is placed by them too.
      style={{ ...playerColors.rootStyle, left: 0, x: offsetX, y: offsetY, opacity: groundOpacity }}
      {...(open ? drag : {})}
      // The cover is an image the browser would otherwise start dragging, taking the pointer away.
      onDragStart={(event) => event.preventDefault()}
    >
      <motion.div
        style={{ opacity: innerOpacity, y: innerRise }}
        className="relative flex min-h-0 flex-1 flex-col"
      >
        <AmbientBackdrop
          imageSrc={accentSrc}
          style={playerColors.style}
          artworkPlacement={artworkPlacement}
          track={playerColors.style === "immersive" ? currentTrack : null}
          loopRunning={!fullBleedLyrics && entered}
          blurred={fullBleedLyrics && lyricsBackground === "player"}
        />

        {/* TOP BAR */}
        <div className="absolute top-0 z-40 grid w-full grid-cols-[1fr_auto_1fr] items-center gap-4 p-6">
          <PlayerButtonGroup className="justify-self-start">
            <GroupItem id="collapse">
              <HapticButton onClick={closeOverlay} aria-label={getString("music_collapse")} whileTap={NO_TAP_SCALE} className={GROUP_BUTTON}>
                <ChevronDown className="h-6 w-6" />
              </HapticButton>
            </GroupItem>
          </PlayerButtonGroup>

          {queueSource ? (
            <p className="line-clamp-1 max-w-md rounded-full bg-[var(--player-tonal)] px-4 py-2 text-center text-sm text-[color-mix(in_srgb,var(--player-ink)_72%,transparent)]">
              {getString("playing_from")} <span className="font-medium text-[var(--player-ink)]">{queueSource}</span>
            </p>
          ) : (
            <span />
          )}

          <PlayerButtonGroup className="relative justify-self-end">
            {isLyrics && (
              <GroupItem id="lyrics-actions">
                <LyricsActionsMenu track={currentTrack} className={GROUP_BUTTON} />
              </GroupItem>
            )}
            {wide && lyricsExpanded && (
              <GroupItem id="back-to-pane">
                <HapticButton
                  onClick={() => setLyricsExpanded(false)}
                  aria-label={getString("music_lyrics_back_to_pane")}
                  title={getString("music_lyrics_back_to_pane")}
                  whileTap={NO_TAP_SCALE}
                  className={GROUP_BUTTON}
                >
                  <Minimize2 className="h-5 w-5" />
                </HapticButton>
              </GroupItem>
            )}

            <GroupItem id="queue">
              <HapticButton
                onClick={onQueueButton}
                aria-label={getString("music_queue")}
                aria-pressed={queueShown}
                whileTap={NO_TAP_SCALE}
                className={queueShown ? GROUP_BUTTON_ACTIVE : GROUP_BUTTON}
              >
                <ListMusic className="h-5 w-5" />
              </HapticButton>
            </GroupItem>

            <GroupItem id="lyrics">
              <HapticButton
                onClick={onLyricsButton}
                aria-label={getString("music_lyrics")}
                aria-pressed={lyricsShown}
                whileTap={NO_TAP_SCALE}
                className={lyricsShown ? GROUP_BUTTON_ACTIVE : GROUP_BUTTON}
              >
                <Mic2 className="h-5 w-5" />
              </HapticButton>
            </GroupItem>

            <GroupItem id="volume">
              <HapticButton
                ref={volumeWheelRef}
                onClick={() => setVolumeOpen((v) => !v)}
                aria-label={getString("music_volume")}
                aria-pressed={volumeOpen}
                whileTap={NO_TAP_SCALE}
                className={volumeOpen ? GROUP_BUTTON_ACTIVE : GROUP_BUTTON}
              >
                {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </HapticButton>
              <div className="absolute end-0 top-full mt-2">
                {volumeFeedback && !volumeOpen && (
                  <VolumeFeedbackPill feedback={volumeFeedback} tone="surface" className="absolute end-0 top-0 z-50" />
                )}
                <VolumePopover open={volumeOpen} onClose={() => setVolumeOpen(false)} />
              </div>
            </GroupItem>

            <GroupItem id="play-on">
              <PlayOnButton className={GROUP_BUTTON} iconSize={20} />
            </GroupItem>

            <GroupItem id="equalizer">
              <HapticButton
                onClick={() => setEqOpen((v) => !v)}
                aria-label={getString("music_equalizer")}
                aria-pressed={eqOpen}
                whileTap={NO_TAP_SCALE}
                className={eqOpen || eqEnabled ? GROUP_BUTTON_ACTIVE : GROUP_BUTTON}
              >
                <SlidersHorizontal className="h-5 w-5" />
              </HapticButton>
            </GroupItem>

            {/* EQ opens BELOW the top bar so it stays in frame */}
            <div className="absolute end-0 top-full mt-2">
              <EqPanel open={eqOpen} onClose={() => setEqOpen(false)} placement="bottom" />
            </div>
          </PlayerButtonGroup>
        </div>

        {/* Playback failure banner — floats below the top bar across all sub-views. */}
        {musicError.errorInfo && (
          <div className="pointer-events-none absolute left-1/2 top-20 z-30 w-full max-w-xl -translate-x-1/2 px-6">
            <div data-sheet-drag-ignore className="pointer-events-auto">
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
            {lyricsBackground !== "player" && <LyricsCoverBackground cover={lyricsCover} moving={lyricsBackground === "moving"} />}
            {lyricsView("full", "absolute inset-0 z-10")}
            <div
              // Over the cover's colours, the controls' scrim fades from the cover's own backdrop.
              style={lyricsOnCover ? ({ "--player-ground": rgbCss(lyricsOnCover.backdrop) } as CSSProperties) : undefined}
              className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-4 bg-linear-to-t from-[color-mix(in_srgb,var(--player-ground)_90%,transparent)] via-[color-mix(in_srgb,var(--player-ground)_50%,transparent)] to-transparent px-6 pb-10 pt-24">
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
            <div className={`flex min-h-0 min-w-0 justify-center ${showPane ? "flex-1" : !wide && isQueue ? "w-1/2" : "w-full max-w-2xl"}`}>
              <NowPlayingColumn
                track={currentTrack}
                compact={!wide && isQueue}
                artworkHidden={playerColors.style === "immersive"}
                onOpenEqualizer={() => setEqOpen(true)}
              />
            </div>

            {wide ? (
              <AnimatePresence mode="popLayout">
                {showPane && (
                  <motion.div
                    key="side-pane"
                    data-sheet-drag-ignore
                    initial={{ opacity: 0, x: 48 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 48 }}
                    transition={LAYOUT_SPRING}
                    className="flex min-h-0 w-[min(460px,40%)] shrink-0"
                  >
                    <PlayerSidePane
                      tab={sideTab}
                      onTabChange={(tab) => setViewState(tab === "lyrics" ? "lyrics" : "queue")}
                      onExpandLyrics={() => setLyricsExpanded(true)}
                      onHide={hidePane}
                      surfaceStyle={paneSurface}
                      background={
                        sideTab === "lyrics" && lyricsBackground !== "player" ? (
                          <LyricsCoverBackground cover={lyricsCover} moving={lyricsBackground === "moving"} />
                        ) : null
                      }
                    >
                      {sideTab === "lyrics" ? lyricsView("pane", "absolute inset-0") : <MusicQueuePane />}
                    </PlayerSidePane>
                  </motion.div>
                )}
              </AnimatePresence>
            ) : (
              <AnimatePresence mode="popLayout">
                {isQueue && (
                  <motion.div
                    key="queue-pane"
                    data-sheet-drag-ignore
                    initial={{ opacity: 0, x: 48 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 48 }}
                    transition={LAYOUT_SPRING}
                    style={paneSurface}
                    className="flex min-h-0 w-1/2 flex-col rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-4 transition-colors duration-500 ease-out"
                  >
                    <MusicQueuePane />
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}
