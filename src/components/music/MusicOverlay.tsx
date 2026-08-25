import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  Disc3,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  ListMusic,
  Mic2,
  SlidersHorizontal,
  Heart,
  MoreHorizontal,
  Loader2,
  RefreshCw,
  Share2,
} from "lucide-react";

import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { useMusicPlayerError } from "../../lib/useMusicPlayerError";
import { PlayerErrorState } from "../ui/PlayerErrorState";
import { useLikesStore } from "../../store/useLikesStore";
import { useUiStore } from "../../store/useUiStore";
import { useAlbumLibraryStore } from "../../store/useAlbumLibraryStore";
import { getString } from "../../lib/i18n/index";
import { artistsText } from "../../lib/musicFormat";
import type { SongItem } from "../../types/music";
import { HapticButton } from "./HapticButton";
import { MusicCardMenu, type MusicMenuAction, useMusicContextMenu } from "./MusicCardMenu";
import { useTrackNavActions } from "./useTrackNavActions";
import { useTrackDownloadAction } from "./useTrackDownloadAction";
import { MusicArtwork } from "./MusicArtwork";
import { MusicScrubber } from "./MusicScrubber";
import { MusicQueuePane } from "./MusicQueuePane";
import { MusicLyrics } from "./MusicLyrics";
import { AmbientBackdrop, isMusicBackgroundStyle } from "./AmbientBackdrop";
import { EqPanel } from "./EqPanel";
import { useLyrics } from "../../lib/lyrics/useLyrics";
import { useDominantColor } from "../../lib/useDominantColor";
import { accentForeground, accentSurface } from "../../lib/accentColor";
import { upgradeMusicImageUrl } from "../../lib/thumbnails";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { usePreference } from "../../lib/usePreference";
import { SETTINGS } from "../../lib/settings/schema";

const TOP_BTN =
  "grid h-10 w-10 place-items-center rounded-full text-chrome-neutral-300 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100";
const TOP_BTN_ACTIVE =
  "grid h-10 w-10 place-items-center rounded-full bg-surface-container-high text-[var(--color-primary)] transition-colors duration-200 ease-out";

const META_BTN =
  "grid h-11 w-11 place-items-center rounded-full text-chrome-neutral-300 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100";

const SIDE = "grid h-11 w-11 place-items-center rounded-full transition-colors duration-200 ease-out";
const SIDE_IDLE = `${SIDE} text-chrome-neutral-300 hover:bg-surface-container-high hover:text-chrome-neutral-100`;

const LAYOUT_SPRING = { type: "spring" as const, stiffness: 320, damping: 36, mass: 0.9 };

function videoIdOf(track: SongItem): string {
  return track.videoId ?? track.id;
}

function trackShareUrl(track: SongItem): string {
  return `https://music.youtube.com/watch?v=${encodeURIComponent(videoIdOf(track))}`;
}

async function shareTrack(track: SongItem) {
  try {
    if (navigator.share) {
      await navigator.share({ title: track.title, url: trackShareUrl(track) });
      return;
    }
    await navigator.clipboard?.writeText(trackShareUrl(track));
  } catch {
  }
}

export function MusicOverlay() {
  const navigate = useNavigate();
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const viewState = useMusicPlayerStore((s) => s.viewState);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const isBuffering = useMusicPlayerStore((s) => s.isBuffering);
  const loadingStreamId = useMusicPlayerStore((s) => s.loadingStreamId);
  const repeatMode = useMusicPlayerStore((s) => s.repeatMode);
  const isShuffle = useMusicPlayerStore((s) => s.isShuffle);
  const eqEnabled = useMusicPlayerStore((s) => s.eqEnabled);

  const togglePlay = useMusicPlayerStore((s) => s.togglePlay);
  const next = useMusicPlayerStore((s) => s.next);
  const previous = useMusicPlayerStore((s) => s.previous);
  const cycleRepeat = useMusicPlayerStore((s) => s.cycleRepeat);
  const toggleShuffle = useMusicPlayerStore((s) => s.toggleShuffle);
  const setViewState = useMusicPlayerStore((s) => s.setViewState);
  const closeOverlay = useMusicPlayerStore((s) => s.closeOverlay);
  const seek = useMusicPlayerStore((s) => s.seek);
  const likedItems = useLikesStore((s) => s.items);
  const likesLoaded = useLikesStore((s) => s.loaded);
  const loadLikes = useLikesStore((s) => s.load);
  const toggleSongLike = useLikesStore((s) => s.toggleSong);
  const showToast = useUiStore((s) => s.showToast);
  const openAddToAlbum = useAlbumLibraryStore((s) => s.openAddToAlbum);
  const menu = useMusicContextMenu(Boolean(currentTrack));

  const musicError = useMusicPlayerError();
  const [eqOpen, setEqOpen] = useState(false);
  const overlayOpen = currentTrack !== null && viewState !== "dock";
  const lyrics = useLyrics(overlayOpen ? currentTrack : null);
  /*
    Sample the URL the artwork actually renders, not the raw field: YouTube
    Music hands back protocol-relative and unsized image URLs, and a bare `//`
    src resolves against the Tauri page origin as http, which `img-src https:`
    then blocks — the load fails and the accent silently falls back to the
    theme colour. Going through the same helpers as `MusicArtwork` normalises
    the URL and reuses its cache entry instead of fetching a second copy.
  */
  const accentSrc = useProxiedImageUrl(upgradeMusicImageUrl(currentTrack?.thumbnail));
  const accent = useDominantColor(accentSrc);
  const [backgroundPref] = usePreference(SETTINGS.MUSIC_PLAYER_BACKGROUND);
  const backgroundStyle = isMusicBackgroundStyle(backgroundPref) ? backgroundPref : "blur_gradient";
  const accentActive = {
    color: accentForeground(accent),
    backgroundColor: accentSurface(accent),
  };
  const liked = Boolean(
    currentTrack && likedItems.some((item) => (
      item.kind === "music" && item.id === (currentTrack.videoId ?? currentTrack.id)
    )),
  );

  const open = overlayOpen;
  const isQueue = viewState === "queue";
  const isLyrics = viewState === "lyrics";
  const loading = isBuffering || loadingStreamId !== null;
  const primaryArtist = currentTrack?.artists?.find((artist) => artist.id) ?? currentTrack?.artists?.[0] ?? null;
  const canOpenArtist = Boolean(primaryArtist?.id);
  const navActions = useTrackNavActions(currentTrack, { onNavigate: closeOverlay });
  const downloadActions = useTrackDownloadAction(currentTrack);
  const menuActions: MusicMenuAction[] = currentTrack
    ? [
        ...navActions,
        {
          id: "add-to-album",
          label: getString("music_add_to_album"),
          icon: <Disc3 size={16} />,
          onSelect: () => openAddToAlbum(currentTrack),
        },
        ...downloadActions,
        {
          id: "share",
          label: getString("music_share"),
          icon: <Share2 size={16} />,
          onSelect: () => shareTrack(currentTrack),
        },
      ]
    : [];

  useEffect(() => {
    if (!likesLoaded) void loadLikes();
  }, [likesLoaded, loadLikes]);

  const handleLike = async () => {
    if (!currentTrack) return;
    try {
      const nowLiked = await toggleSongLike(currentTrack);
      showToast({
        variant: "success",
        message: getString(nowLiked ? "liked_added_toast" : "liked_removed_toast"),
      });
    } catch (error) {
      console.warn("Failed to update music like", error);
      showToast({ variant: "error", message: getString("liked_update_failed") });
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeOverlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeOverlay]);

  return (
    <AnimatePresence>
      {open && currentTrack && (
        <motion.div
          key="music-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-x-0 bottom-0 top-8 z-[60] flex flex-col overflow-hidden bg-chrome-neutral-950"
        >
          <AmbientBackdrop src={currentTrack.thumbnail} accent={accent} style={backgroundStyle} />

          {/* TOP BAR */}
          <div className="absolute top-0 z-20 flex w-full items-center justify-between p-6">
            <HapticButton
              onClick={closeOverlay}
              aria-label={getString("music_collapse")}
              className={TOP_BTN}
            >
              <ChevronDown className="h-6 w-6" />
            </HapticButton>

            <div className="relative flex items-center gap-1">
              {isLyrics && (
                <HapticButton
                  onClick={() => lyrics.refresh()}
                  aria-label={getString("music_refresh_lyrics")}
                  className={TOP_BTN}
                >
                  <RefreshCw className="h-5 w-5" />
                </HapticButton>
              )}

              <HapticButton
                onClick={() => setViewState(isQueue ? "full" : "queue")}
                aria-label={getString("music_queue")}
                aria-pressed={isQueue}
                className={isQueue ? TOP_BTN_ACTIVE : TOP_BTN}
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
          {isLyrics ? (
            <>
              <MusicLyrics
                entries={lyrics.entries}
                plain={lyrics.plain}
                isSynced={lyrics.isSynced}
                loading={lyrics.loading}
                providerName={lyrics.providerName}
                accent={accent}
                onSeek={seek}
                className="absolute inset-0 z-10"
              />
              <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-4 bg-linear-to-t from-chrome-neutral-950/90 via-chrome-neutral-950/50 to-transparent px-6 pb-10 pt-24">
                <div className="w-full max-w-2xl">
                  <MusicScrubber size="lg" showTimes countdown />
                </div>
                <div className="flex items-center justify-center gap-8">
                  <HapticButton
                    onClick={previous}
                    aria-label={getString("music_previous")}
                    className="grid h-11 w-11 place-items-center rounded-full text-chrome-neutral-100 transition-transform duration-200 ease-out hover:scale-110"
                  >
                    <SkipBack className="h-6 w-6" fill="currentColor" />
                  </HapticButton>
                  <HapticButton
                    onClick={togglePlay}
                    aria-label={getString(isPlaying ? "music_pause" : "music_play")}
                    className="grid h-14 w-14 place-items-center rounded-full bg-[var(--color-primary)] text-[var(--color-on-primary)] transition-transform duration-200 ease-out hover:scale-105"
                  >
                    {loading ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : isPlaying ? (
                      <Pause className="h-6 w-6" fill="currentColor" />
                    ) : (
                      <Play className="h-6 w-6 translate-x-px" fill="currentColor" />
                    )}
                  </HapticButton>
                  <HapticButton
                    onClick={next}
                    aria-label={getString("music_next")}
                    className="grid h-11 w-11 place-items-center rounded-full text-chrome-neutral-100 transition-transform duration-200 ease-out hover:scale-110"
                  >
                    <SkipForward className="h-6 w-6" fill="currentColor" />
                  </HapticButton>
                </div>
              </div>
            </>
          ) : (
            <motion.div
              layout
              transition={LAYOUT_SPRING}
              className="relative z-10 flex min-h-0 flex-1 items-stretch justify-center gap-8 px-6 pb-14 pt-20"
            >
            {/* NOW-PLAYING COLUMN */}
            <motion.div
              layout
              transition={LAYOUT_SPRING}
              className={`flex min-w-0 flex-col items-center justify-center ${
                isQueue ? "w-1/2" : "w-full max-w-2xl"
              }`}
            >
              <MusicArtwork
                layoutId="album-art"
                src={currentTrack.thumbnail}
                alt={currentTrack.title}
                loading={loading}
                iconClassName="h-16 w-16"
                className={`aspect-square shrink-0 rounded-2xl shadow-[0_20px_50px_color-mix(in_srgb,var(--color-chrome-black)_50%,transparent)] ${
                  isQueue ? "w-[min(400px,50vh)]" : "w-[min(480px,55vh)]"
                }`}
              />

              {/* CONTROL CLUSTER */}
              <div className="mt-8 flex w-full max-w-2xl flex-col gap-5">
                {/* metadata row */}
                <div
                  ref={menu.cardRef}
                  onContextMenu={menu.openMenuFromContext}
                  className="flex items-start justify-between gap-4"
                >
                  <div className="min-w-0">
                    <h1
                      title={currentTrack.title}
                      className={`font-bold tracking-tight text-chrome-neutral-100 ${
                        isQueue ? "line-clamp-1 text-2xl" : "line-clamp-1 text-3xl lg:text-5xl"
                      }`}
                    >
                      {currentTrack.title}
                    </h1>
                    <button
                      type="button"
                      disabled={!canOpenArtist}
                      onClick={() => {
                        if (!primaryArtist?.id) return;
                        closeOverlay();
                        navigate(`/music/artist/${primaryArtist.id}`);
                      }}
                      className="mt-2 line-clamp-1 max-w-full text-left text-base text-chrome-neutral-300 transition-colors hover:text-chrome-neutral-100 disabled:cursor-default disabled:hover:text-chrome-neutral-300 lg:text-lg"
                    >
                      {artistsText(currentTrack.artists)}
                    </button>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <HapticButton
                      onClick={() => void handleLike()}
                      aria-label={getString("music_like")}
                      aria-pressed={liked}
                      className={liked ? `${META_BTN} text-[var(--color-primary)]` : META_BTN}
                    >
                      <Heart className="h-5 w-5" fill={liked ? "currentColor" : "none"} />
                    </HapticButton>
                    <HapticButton
                      onClick={menu.openMenuFromDots}
                      aria-label={getString("music_more_actions")}
                      className={META_BTN}
                    >
                      <MoreHorizontal className="h-5 w-5" />
                    </HapticButton>
                  </div>
                  <MusicCardMenu
                    actions={menuActions}
                    anchor={menu.anchor}
                    onClose={menu.closeMenu}
                    show={menu.showMenu}
                  />
                </div>

                {/* scrubber row */}
                <MusicScrubber size="lg" showTimes countdown />

                {/* playback row */}
                <div className="flex w-full items-center justify-between">
                  <HapticButton
                    onClick={toggleShuffle}
                    aria-label={getString("music_shuffle")}
                    aria-pressed={isShuffle}
                    className={isShuffle ? SIDE : SIDE_IDLE}
                    style={isShuffle ? accentActive : undefined}
                  >
                    <Shuffle className="h-5 w-5" />
                  </HapticButton>

                  <div className="flex items-center gap-6">
                    <HapticButton
                      onClick={previous}
                      aria-label={getString("music_previous")}
                      className="grid h-12 w-12 place-items-center rounded-full text-chrome-neutral-100 transition-transform duration-200 ease-out hover:scale-110"
                    >
                      <SkipBack className="h-7 w-7" fill="currentColor" />
                    </HapticButton>

                    <HapticButton
                      onClick={togglePlay}
                      aria-label={getString(isPlaying ? "music_pause" : "music_play")}
                      className="grid h-16 w-16 place-items-center rounded-full bg-[var(--color-primary)] text-[var(--color-on-primary)] transition-transform duration-200 ease-out hover:scale-105"
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
                      className="grid h-12 w-12 place-items-center rounded-full text-chrome-neutral-100 transition-transform duration-200 ease-out hover:scale-110"
                    >
                      <SkipForward className="h-7 w-7" fill="currentColor" />
                    </HapticButton>
                  </div>

                  <HapticButton
                    onClick={cycleRepeat}
                    aria-label={
                      repeatMode === "one" ? getString("music_repeat_one") : getString("music_repeat")
                    }
                    aria-pressed={repeatMode !== "none"}
                    className={repeatMode !== "none" ? SIDE : SIDE_IDLE}
                    style={repeatMode !== "none" ? accentActive : undefined}
                  >
                    {repeatMode === "one" ? (
                      <Repeat1 className="h-5 w-5" />
                    ) : (
                      <Repeat className="h-5 w-5" />
                    )}
                  </HapticButton>
                </div>
              </div>
            </motion.div>

            {/* QUEUE PANE — popLayout so the column reflows immediately on close */}
            <AnimatePresence mode="popLayout">
              {isQueue && (
                <motion.div
                  key="queue-pane"
                  initial={{ opacity: 0, x: 48 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 48 }}
                  transition={LAYOUT_SPRING}
                  className="flex min-h-0 w-1/2 flex-col rounded-2xl border border-chrome-neutral-800 bg-chrome-neutral-950/40 p-4"
                >
                  <MusicQueuePane />
                </motion.div>
              )}
            </AnimatePresence>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
