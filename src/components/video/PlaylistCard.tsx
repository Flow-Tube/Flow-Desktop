
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Library, ListVideo, MoreVertical } from 'lucide-react';
import type { PlaylistSummary } from '../../types/video';
import {
  isPlaylistInLibrary,
  isProtectedPlaylistId,
  removePlaylistFromLibrary,
  savePlaylistToLibrary,
} from '../../lib/playlistLibrary';
import { loadPlaylistDownload } from '../../lib/useCollectionDownloads';
import { useDownloadStore } from '../../store/useDownloadStore';
import { useImageFallback } from '../../lib/useImageFallback';
import { showSaveFailedToast, showSaveToast } from '../../lib/saveToast';
import { getString } from '../../lib/i18n/index';
import type { MenuAnchor } from '../ui/AnchoredPortalMenu';
import { MediaMenu, type MediaMenuAction } from '../ui/MediaMenu';
import { ColorWash, COLOR_WASH_HOST } from '../ui/ColorWash';
import { SoftBackdrop } from '../ui/SoftBackdrop';
import { useHoverWashColor } from '../../lib/useHoverWashColor';

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
}

function StackedPlaylistThumbnail({
  thumbnailUrl,
  title,
  videoCountText,
}: {
  thumbnailUrl?: string | null;
  title: string;
  videoCountText: string;
}) {
  const { src, onError } = useImageFallback([thumbnailUrl]);

  if (!src) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-chrome-zinc-800">
        <div className="flex h-full w-full items-center justify-center text-chrome-neutral-500">
          <ListVideo size={32} />
        </div>
        <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1.5 rounded bg-chrome-black/80 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-chrome-white">
          <ListVideo size={14} />
          {videoCountText}
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full pt-2.5">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-4 right-4 top-0 z-0 aspect-video overflow-hidden rounded-xl"
      >
        <SoftBackdrop src={src} detail={24} className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-chrome-black/55" />
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-2 right-2 top-1 z-[1] aspect-video overflow-hidden rounded-xl"
      >
        <SoftBackdrop src={src} detail={40} className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-chrome-black/35" />
      </div>

      <div className="relative z-10 aspect-video w-full overflow-hidden rounded-xl bg-chrome-zinc-900">
        <img
          src={src}
          alt={title}
          onError={onError}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1.5 rounded bg-chrome-black/80 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-chrome-white">
          <ListVideo size={14} />
          {videoCountText}
        </div>
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
}: PlaylistCardProps) {
  const navigate = useNavigate();
  const [showMenu, setShowMenu] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [isSaved, setIsSaved] = useState(Boolean(isInLibrary));
  const cardRef = useRef<HTMLDivElement>(null);
  const openCollectionDownload = useDownloadStore((state) => state.openCollection);
  const wash = useHoverWashColor(playlist.thumbnailUrl);
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
    setMenuAnchor({ top: event.clientY, left: event.clientX });
    setShowMenu(true);
  }, []);

  const openMenuFromDots = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuAnchor({ top: rect.bottom + 4, right: rect.right });
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
      if (!await remove()) return;
      showSaveToast({ destination: { kind: 'library' }, item: toastItem, removed: true, undo: save });
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
      onSelect: () => navigate(`/playlist/${playlist.id}`),
    },
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
      className={`group ${COLOR_WASH_HOST} flex cursor-pointer flex-col gap-3`}
      onMouseEnter={wash.onMouseEnter}
      onMouseLeave={wash.onMouseLeave}
      onClick={() => {
        if (onClick) {
          onClick(playlist);
          return;
        }
        navigate(`/playlist/${playlist.id}`);
      }}
      onContextMenu={handleContextMenu}
    >
      <ColorWash active={wash.isHovered} color={wash.color} alpha={0.2} bleed={6} />

      <StackedPlaylistThumbnail
        thumbnailUrl={playlist.thumbnailUrl}
        title={playlist.title}
        videoCountText={videoCountText}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm font-semibold leading-tight text-chrome-zinc-100 transition-colors group-hover:text-primary">
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
            aria-label="Open playlist actions"
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
