import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Heart, MoreHorizontal } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import { artistsText } from "../../../lib/musicFormat";
import { useElementSize } from "../../../lib/useElementSize";
import { useLikesStore } from "../../../store/useLikesStore";
import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import { toggleSongLikeWithToast } from "../../../lib/songLikeToast";
import type { SongItem } from "../../../types/music";
import { HapticButton } from "../HapticButton";
import { MusicArtwork } from "../MusicArtwork";
import { MusicCardMenu, useMusicContextMenu } from "../MusicCardMenu";
import { MusicScrubber } from "../MusicScrubber";
import { MusicSleepTimerButton } from "../MusicSleepTimerButton";
import { useNowPlayingMenuActions } from "../useNowPlayingMenuActions";
import { PlayerTransport } from "./PlayerTransport";

const META_BTN =
  "grid h-11 w-11 place-items-center rounded-full text-chrome-neutral-300 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100";

/** Room the title, seek bar and transport need under the artwork, in px. */
const DETAILS_HEIGHT = 300;
const MAX_ART = 520;
const MIN_ART = 160;

export const LAYOUT_SPRING = { type: "spring" as const, stiffness: 320, damping: 36, mass: 0.9 };

interface NowPlayingColumnProps {
  track: SongItem;
  /** A narrower column next to the queue, with a smaller title. */
  compact: boolean;
  /** Immersive draws the cover full-bleed behind the player, so the card keeps its place but not its picture. */
  artworkHidden: boolean;
  onOpenEqualizer: () => void;
}

/**
 * The song itself: artwork, title and artist, like and menu, seek bar and
 * transport. The artwork takes whatever square the column has left above the
 * details, so it never pushes the controls out of a short window.
 */
export function NowPlayingColumn({ track, compact, artworkHidden, onOpenEqualizer }: NowPlayingColumnProps) {
  const navigate = useNavigate();
  const columnRef = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(columnRef);
  const artSize = Math.round(Math.max(MIN_ART, Math.min(MAX_ART, height - DETAILS_HEIGHT, width)));

  const loading = useMusicPlayerStore((s) => s.isBuffering || s.loadingStreamId !== null);
  const closeOverlay = useMusicPlayerStore((s) => s.closeOverlay);
  const likedItems = useLikesStore((s) => s.items);
  const likesLoaded = useLikesStore((s) => s.loaded);
  const loadLikes = useLikesStore((s) => s.load);
  const menu = useMusicContextMenu(true);
  const menuActions = useNowPlayingMenuActions(track, { onNavigate: closeOverlay, onOpenEqualizer });

  const videoId = track.videoId ?? track.id;
  const liked = likedItems.some((item) => item.kind === "music" && item.id === videoId);
  const primaryArtist = track.artists?.find((artist) => artist.id) ?? track.artists?.[0] ?? null;

  useEffect(() => {
    if (!likesLoaded) void loadLikes();
  }, [likesLoaded, loadLikes]);

  const handleLike = () => toggleSongLikeWithToast(track, liked);

  return (
    <motion.div
      ref={columnRef}
      layout
      transition={LAYOUT_SPRING}
      className="flex h-full min-h-0 w-full min-w-0 flex-col items-center justify-center"
    >
      <MusicArtwork
        layoutId="album-art"
        src={track.thumbnail}
        alt={track.title}
        loading={loading}
        iconClassName="h-16 w-16"
        // Visibility, not opacity: the shared-layout morph writes its own inline opacity.
        className={`aspect-square shrink-0 rounded-2xl ${artworkHidden ? "invisible" : ""}`}
        style={{ width: artSize }}
      />

      <div className="mt-8 flex w-full max-w-2xl flex-col gap-5">
        <div ref={menu.cardRef} onContextMenu={menu.openMenuFromContext} className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1
              title={track.title}
              className={`line-clamp-1 select-text font-bold tracking-tight text-chrome-neutral-100 ${compact ? "text-2xl" : "text-3xl lg:text-5xl"}`}
            >
              {track.title}
            </h1>
            <button
              type="button"
              disabled={!primaryArtist?.id}
              onClick={() => {
                if (!primaryArtist?.id) return;
                closeOverlay();
                navigate(`/music/artist/${primaryArtist.id}`);
              }}
              className="mt-2 line-clamp-1 max-w-full text-left text-base text-chrome-neutral-300 transition-colors hover:text-chrome-neutral-100 disabled:cursor-default disabled:hover:text-chrome-neutral-300 lg:text-lg"
            >
              {artistsText(track.artists)}
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <MusicSleepTimerButton className={META_BTN} activeClassName={`${META_BTN} text-[var(--color-primary)]`} />
            <HapticButton
              onClick={() => void handleLike()}
              aria-label={getString("music_like")}
              aria-pressed={liked}
              className={liked ? `${META_BTN} text-[var(--color-primary)]` : META_BTN}
            >
              <Heart className="h-5 w-5" fill={liked ? "currentColor" : "none"} />
            </HapticButton>
            <HapticButton onClick={menu.openMenuFromDots} aria-label={getString("music_more_actions")} className={META_BTN}>
              <MoreHorizontal className="h-5 w-5" />
            </HapticButton>
          </div>
          <MusicCardMenu actions={menuActions} anchor={menu.anchor} onClose={menu.closeMenu} show={menu.showMenu} />
        </div>

        <MusicScrubber size="lg" showTimes countdown expressive />
        <PlayerTransport />
      </div>
    </motion.div>
  );
}
