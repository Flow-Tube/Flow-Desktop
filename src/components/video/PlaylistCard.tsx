
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Library, ListVideo, MoreVertical } from 'lucide-react';
import type { PlaylistSummary } from '../../types/video';
import { confirmPlaylistRemoval } from '../../lib/confirmPlaylistRemoval';
import {
  isOwnedPlaylist,
  isPlaylistInLibrary,
  isProtectedPlaylistId,
  removePlaylistFromLibrary,
  savePlaylistToLibrary,
} from '../../lib/playlistLibrary';
import { loadPlaylistDownload } from '../../lib/useCollectionDownloads';
import { useDownloadStore } from '../../store/useDownloadStore';
import { useImageFallback } from '../../lib/useImageFallback';
import { isUnavailableYoutubeThumbnail, resolveYoutubeThumbnailCandidates, thumbnailVideoId } from '../../lib/thumbnails';
import { useCoverColorSample } from '../../lib/useCoverColorSample';
import { useArtworkSwatches } from '../../lib/useArtworkSwatches';
import type { Rgb } from '../../lib/useDominantColor';
import { showSaveFailedToast, showSaveToast } from '../../lib/saveToast';
import { getString } from '../../lib/i18n/index';
import type { MenuAnchor } from '../ui/AnchoredPortalMenu';
import { MediaMenu, type MediaMenuAction } from '../ui/MediaMenu';
import { ColorWash, COLOR_WASH_HOST } from '../ui/ColorWash';
import { useHoverWashColor } from '../../lib/useHoverWashColor';
import { backgroundTabClickProps, cardKeyboardProps, openedInBackgroundTab } from '../../lib/openTarget';
import { openActions } from '../common/openActions';
import { alignToEnd, growFromPoint } from '../../lib/direction';
import { hoverMotion } from '../../lib/platform';

interface PlaylistCardProps {
  playlist: PlaylistSummary & {
    description?: string | null;
    videoCount?: number;
    isProtected?: boolean;
  };
  isInLibrary?: boolean;
  onClick?: (playlist: PlaylistSummary) => void;
  onSaveToLibrary?: (playlist: PlaylistSummary) => void | boolean | Promise<void | boolean>;
  onRemoveFromLibrary?: (playlist: PlaylistSummary) => void | boolean | Promise<void | boolean>;
  onDownload?: (playlist: PlaylistSummary) => void;
  /** Drawn over the thumbnail, such as a download's progress. */
  thumbnailOverlay?: React.ReactNode;
  appendActions?: MediaMenuAction[];
  /** The widest the cover is drawn, in CSS px, for a row whose cards have a fixed width. */
  thumbnailWidth?: number;
}

// The share of the cover's colour in each sheet, as on Android: the near sheet takes more.
const NEAR_SHEET_TINT = 55;
const FAR_SHEET_TINT = 35;

/** A theme surface blended toward the cover's colour, or the plain surface until there is one. */
function sheetTone(surface: string, tint: Rgb | null, amount: number): string {
  return tint ? `color-mix(in oklab, var(${surface}), rgb(${tint.r} ${tint.g} ${tint.b}) ${amount}%)` : `var(${surface})`;
}

const SHEET_CLASS = `pointer-events-none absolute aspect-video rounded-xl ${hoverMotion('transition-colors duration-200 ease-out motion-reduce:transition-none')}`;

/**
 * The cover under two sheets that peek out above it, each narrower than the one in front, so it
 * reads as a stack. Once the cover has loaded, the sheets take its colour, blended into the theme's
 * surface tones so they stay visible in light and dark themes.
 */
export function StackedPlaylistThumbnail({
  thumbnailUrl,
  title,
  videoCountText,
  overlay,
  thumbnailWidth,
}: {
  thumbnailUrl?: string | null;
  title: string;
  videoCountText: string;
  overlay?: React.ReactNode;
  /** The widest the cover is drawn, in CSS px; left out, the screen's pixel ratio decides. */
  thumbnailWidth?: number;
}) {
  // A YouTube cover is its first video's thumbnail, which an old upload may lack at the larger sizes.
  // Any other cover, such as album art or a local playlist's, is drawn as given.
  const candidates = useMemo(
    () => thumbnailVideoId(thumbnailUrl)
      ? resolveYoutubeThumbnailCandidates(null, thumbnailUrl, thumbnailWidth)
      : [thumbnailUrl],
    [thumbnailUrl, thumbnailWidth],
  );
  const { src, onError, onLoad, isLast } = useImageFallback(candidates);
  const [coverLoaded, setCoverLoaded] = useState(false);
  const handleLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    if (!isLast && isUnavailableYoutubeThumbnail(event.currentTarget)) {
      onError();
      return;
    }
    onLoad();
    setCoverLoaded(true);
  };
  const swatches = useArtworkSwatches(useCoverColorSample(coverLoaded ? thumbnailUrl : null));
  const tint = swatches?.accent ?? swatches?.base ?? null;

  return (
    <div className="relative w-full pt-2.5">
      <div
        aria-hidden="true"
        className={`${SHEET_CLASS} start-4 end-4 top-0 z-0`}
        style={{ backgroundColor: sheetTone('--color-surface-container-high', tint, FAR_SHEET_TINT) }}
      />
      <div
        aria-hidden="true"
        className={`${SHEET_CLASS} start-2 end-2 top-1 z-[1]`}
        style={{ backgroundColor: sheetTone('--color-surface-container-highest', tint, NEAR_SHEET_TINT) }}
      />

      <div className="relative z-10 aspect-video w-full overflow-hidden rounded-xl bg-chrome-zinc-900">
        {src ? (
          <img
            src={src}
            alt={title}
            onError={onError}
            onLoad={handleLoad}
            className={`h-full w-full object-cover ${hoverMotion("transition-transform duration-300 group-hover:scale-105")}`}
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-chrome-neutral-500">
            <ListVideo size={32} />
          </div>
        )}
        <div className="absolute bottom-1.5 end-1.5 flex items-center gap-1.5 rounded bg-chrome-black/80 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-chrome-white">
          <ListVideo size={14} />
          {videoCountText}
        </div>
        {overlay}
      </div>
    </div>
  );
}

export function PlaylistCard({
  playlist,
  isInLibrary,
  onClick,
  onSaveToLibrary,
  onRemoveFromLibrary,
  onDownload,
  thumbnailOverlay,
  appendActions = [],
  thumbnailWidth,
}: PlaylistCardProps) {
  const navigate = useNavigate();
  const [showMenu, setShowMenu] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [isSaved, setIsSaved] = useState(Boolean(isInLibrary));
  const cardRef = useRef<HTMLDivElement>(null);
  const openCollectionDownload = useDownloadStore((state) => state.openCollection);
  const wash = useHoverWashColor(useCoverColorSample(playlist.thumbnailUrl));
  const isProtected = Boolean(playlist.isProtected) || isProtectedPlaylistId(playlist.id);

  const resolvedVideoCount = typeof playlist.videoCount === 'number' && playlist.videoCount > 0
    ? playlist.videoCount
    : null;

  const videoCountText = playlist.videoCountText
    ?? (resolvedVideoCount != null
      ? `${resolvedVideoCount} ${resolvedVideoCount === 1 ? 'video' : 'videos'}`
      : 'Playlist');

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuAnchor({ top: event.clientY, ...growFromPoint(event.clientX) });
    setShowMenu(true);
  }, []);

  const openMenuFromDots = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuAnchor({ top: rect.bottom + 4, ...alignToEnd(rect) });
    setShowMenu((current) => !current);
  }, []);

  useEffect(() => {
    if (isProtected) {
      setIsSaved(true);
      return;
    }

    if (typeof isInLibrary === 'boolean') {
      setIsSaved(isInLibrary);
      return;
    }

    let active = true;
    isPlaylistInLibrary(playlist.id)
      .then((saved) => {
        if (active) setIsSaved(saved);
      })
      .catch((error) => {
        console.warn('Failed to read playlist library state', error);
      });

    return () => {
      active = false;
    };
  }, [isInLibrary, isProtected, playlist.id]);

  const toastItem = { title: playlist.title, image: playlist.thumbnailUrl, shape: 'landscape' as const };

  // Each returns false when the owner of the card declined the change.
  const save = async () => {
    const result = onSaveToLibrary
      ? await onSaveToLibrary(playlist)
      : await savePlaylistToLibrary(playlist);
    if (result === false) return false;
    setIsSaved(true);
    return true;
  };

  const remove = async () => {
    const result = onRemoveFromLibrary
      ? await onRemoveFromLibrary(playlist)
      : await removePlaylistFromLibrary(playlist.id);
    if (result === false) return false;
    setIsSaved(false);
    return true;
  };

  const handleSaveToLibrary = async () => {
    try {
      if (!await save()) return;
      showSaveToast({ destination: { kind: 'library' }, item: toastItem, undo: remove });
    } catch (error) {
      console.error('Failed to save playlist to library', error);
      showSaveFailedToast({ destination: { kind: 'library' }, item: toastItem, retry: handleSaveToLibrary });
    }
  };

  const handleRemoveFromLibrary = async () => {
    if (isProtected) return;

    try {
      const owned = await isOwnedPlaylist(playlist.id);
      if (!await confirmPlaylistRemoval(playlist, owned)) return;
      if (!await remove()) return;
      // Undo saves again from YouTube, which doesn't know a playlist made in Flow.
      showSaveToast({ destination: { kind: 'library' }, item: toastItem, removed: true, undo: owned ? undefined : save });
    } catch (error) {
      console.error('Failed to remove playlist from library', error);
      showSaveFailedToast({ destination: { kind: 'library' }, item: toastItem, removed: true, retry: handleRemoveFromLibrary });
    }
  };

  const handleDownload = async () => {
    if (onDownload) {
      onDownload(playlist);
      return;
    }
    openCollectionDownload({
      kind: 'playlist',
      meta: {
        collectionId: playlist.id,
        title: playlist.title,
        thumbnailUrl: playlist.thumbnailUrl ?? undefined,
      },
      load: async () => (await loadPlaylistDownload(playlist)).videos,
    });
  };

  const playlistRoute = `/playlist/${playlist.id}`;
  const menuActions: MediaMenuAction[] = [
    ...(isProtected
      ? []
      : [{
        id: 'library',
        label: getString(isSaved ? 'menu_remove_from_library' : 'menu_save_to_library'),
        tileLabel: getString(isSaved ? 'menu_tile_saved' : 'menu_tile_save'),
        icon: <Library size={18} />,
        group: 'quick' as const,
        active: isSaved,
        onSelect: isSaved ? handleRemoveFromLibrary : handleSaveToLibrary,
      }]),
    {
      id: 'download',
      label: getString('download'),
      tileLabel: getString('menu_tile_download'),
      icon: <Download size={18} />,
      group: 'quick',
      onSelect: handleDownload,
    },
    {
      id: 'open',
      label: getString('playlist_card_view_full'),
      icon: <ListVideo size={16} />,
      group: 'go',
      onSelect: () => navigate(playlistRoute),
    },
    ...openActions(playlistRoute),
    ...appendActions,
  ];

  const renderMenu = () => {
    if (!showMenu || !menuAnchor) return null;

    return (
      <MediaMenu
        anchor={menuAnchor}
        onClose={() => setShowMenu(false)}
        header={{ title: playlist.title, subtitle: videoCountText, image: playlist.thumbnailUrl, imageShape: 'landscape' }}
        actions={menuActions}
      />
    );
  };

  return (
    <div
      ref={cardRef}
      className={`group ${COLOR_WASH_HOST} flex cursor-pointer flex-col gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
      {...cardKeyboardProps(() => (onClick ? onClick(playlist) : navigate(playlistRoute)), onClick ? null : playlistRoute)}
      aria-label={playlist.title}
      onMouseEnter={wash.onMouseEnter}
      onMouseLeave={wash.onMouseLeave}
      onClick={(event) => {
        if (onClick) {
          onClick(playlist);
          return;
        }
        if (openedInBackgroundTab(event, playlistRoute)) return;
        navigate(playlistRoute);
      }}
      {...(onClick ? {} : backgroundTabClickProps(playlistRoute))}
      onContextMenu={handleContextMenu}
    >
      <ColorWash active={wash.isHovered} color={wash.color} alpha={0.2} bleed={6} />

      <StackedPlaylistThumbnail
        thumbnailUrl={playlist.thumbnailUrl}
        title={playlist.title}
        videoCountText={videoCountText}
        overlay={thumbnailOverlay}
        thumbnailWidth={thumbnailWidth}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 dir="auto" className="line-clamp-2 text-sm font-semibold leading-tight text-chrome-zinc-100 transition-colors group-hover:text-primary">
            {playlist.title}
          </h3>
          <p className="mt-1 line-clamp-1 text-xs font-medium text-chrome-zinc-400 transition-colors">
            {playlist.description || getString('playlist_card_view_full')}
          </p>
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={openMenuFromDots}
            aria-label={getString('video_open_playlist_actions')}
            className="mt-0.5 rounded-full p-1 text-chrome-zinc-500 opacity-0 transition-all duration-150 hover:bg-chrome-zinc-800 hover:text-chrome-zinc-200 group-hover:opacity-100"
          >
            <MoreVertical size={18} />
          </button>

        </div>
      </div>

      {renderMenu()}
    </div>
  );
}
