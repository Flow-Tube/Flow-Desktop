import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Heart, MoreHorizontal } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import { SETTINGS } from "../../../lib/settings/schema";
import { useBoolPref } from "../../../lib/usePreference";
import { useElementSize } from "../../../lib/useElementSize";
import { useLikesStore } from "../../../store/useLikesStore";
import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import { isLocalMediaId } from "../../../lib/localMediaId";
import { toggleSongLikeWithToast } from "../../../lib/songLikeToast";
import type { SongItem } from "../../../types/music";
import { HapticButton } from "../HapticButton";
import { ArtistLinks } from "../ArtistLinks";
import { MusicArtwork } from "../MusicArtwork";
import { MusicCardMenu, useMusicContextMenu } from "../MusicCardMenu";
import { MusicScrubber } from "../MusicScrubber";
import { MusicSleepTimerButton } from "../MusicSleepTimerButton";
import { useNowPlayingMenuActions } from "../useNowPlayingMenuActions";
import { AnimatedArtworkLoop } from "./AnimatedArtworkLoop";
import { HiddenArtworkPlate } from "./HiddenArtworkPlate";
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
  const columnRef = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(columnRef);
  const artSize = Math.round(Math.max(MIN_ART, Math.min(MAX_ART, height - DETAILS_HEIGHT, width)));

  const [hideArtwork] = useBoolPref(SETTINGS.MUSIC_HIDE_ARTWORK);
  const loading = useMusicPlayerStore((s) => s.isBuffering || s.loadingStreamId !== null);
  const closeOverlay = useMusicPlayerStore((s) => s.closeOverlay);
  const likedItems = useLikesStore((s) => s.items);
  const likesLoaded = useLikesStore((s) => s.loaded);
  const loadLikes = useLikesStore((s) => s.load);
  const menu = useMusicContextMenu(true);
  const menuActions = useNowPlayingMenuActions(track, { onNavigate: closeOverlay, onOpenEqualizer });

  const videoId = track.videoId ?? track.id;
  const liked = likedItems.some((item) => item.kind === "music" && item.id === videoId);

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
      <motion.div
        layout
        transition={LAYOUT_SPRING}
        className={`relative aspect-square shrink-0 overflow-hidden rounded-2xl ${artworkHidden ? "invisible" : ""}`}
        style={{ width: artSize }}
      >
        {hideArtwork ? (
          <HiddenArtworkPlate track={track} />
        ) : (
          <>
            <MusicArtwork
              src={track.thumbnail}
              alt={track.title}
              loading={loading}
              iconClassName="h-16 w-16"
              className="h-full w-full rounded-2xl"
            />
            {!artworkHidden && <AnimatedArtworkLoop track={track} />}
          </>
        )}
      </motion.div>

      {/* Its own layout lets framer undo the column's resize scale. Position only, so a change in its own width can't squash the text either. */}
      <motion.div layout="position" transition={LAYOUT_SPRING} className="mt-8 flex w-full max-w-2xl flex-col gap-5">
        <div ref={menu.cardRef} onContextMenu={menu.openMenuFromContext} className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 dir="auto"
              title={track.title}
              className={`line-clamp-1 select-text font-bold tracking-tight text-chrome-neutral-100 ${compact ? "text-2xl" : "text-3xl lg:text-5xl"}`}
            >
              {track.title}
            </h1>
            <ArtistLinks
              artists={track.artists}
              onNavigate={closeOverlay}
              className="mt-2 line-clamp-1 max-w-full text-start text-base text-chrome-neutral-300 lg:text-lg"
            />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <MusicSleepTimerButton className={META_BTN} activeClassName={`${META_BTN} text-[var(--color-primary)]`} />
            {!isLocalMediaId(videoId) && (
              <HapticButton
                onClick={() => void handleLike()}
                aria-label={getString("music_like")}
                aria-pressed={liked}
                className={liked ? `${META_BTN} text-[var(--color-primary)]` : META_BTN}
              >
                <Heart className="h-5 w-5" fill={liked ? "currentColor" : "none"} />
              </HapticButton>
            )}
            <HapticButton onClick={menu.openMenuFromDots} aria-label={getString("music_more_actions")} className={META_BTN}>
              <MoreHorizontal className="h-5 w-5" />
            </HapticButton>
          </div>
          <MusicCardMenu actions={menuActions} anchor={menu.anchor} onClose={menu.closeMenu} show={menu.showMenu} />
        </div>

        <MusicScrubber size="lg" showTimes countdown expressive />
        <PlayerTransport />
      </motion.div>
    </motion.div>
  );
}
