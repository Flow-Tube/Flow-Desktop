
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, ListVideo, MoreVertical, Plus, Trash2 } from 'lucide-react';
import type { PlaylistSummary } from '../../types/video';
import {
  isPlaylistInLibrary,
  isProtectedPlaylistId,
  removePlaylistFromLibrary,
  savePlaylistToLibrary,
} from '../../lib/playlistLibrary';
import { downloadPlaylist } from '../../lib/useCollectionDownloads';
import { useUiStore } from '../../store/useUiStore';
import { AnchoredPortalMenu, type MenuAnchor } from '../ui/AnchoredPortalMenu';
import { ColorWash, COLOR_WASH_HOST } from '../ui/ColorWash';
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
  if (!thumbnailUrl) {
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
        <img
          src={thumbnailUrl}
          alt=""
          className="h-full w-full scale-110 object-cover blur-md brightness-[0.45] saturate-75"
          loading="lazy"
        />
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-2 right-2 top-1 z-[1] aspect-video overflow-hidden rounded-xl"
      >
        <img
          src={thumbnailUrl}
          alt=""
          className="h-full w-full scale-105 object-cover blur-sm brightness-[0.65] saturate-90"
          loading="lazy"
        />
      </div>

      <div className="relative z-10 aspect-video w-full overflow-hidden rounded-xl bg-chrome-zinc-900">
        <img
          src={thumbnailUrl}
          alt={title}
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
  const showToast = useUiStore((state) => state.showToast);
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

  const handleSaveToLibrary = async () => {
    try {
      const result = onSaveToLibrary
        ? await onSaveToLibrary(playlist)
        : await savePlaylistToLibrary(playlist);

      if (result === false) return;

      setIsSaved(true);
      showToast({
        variant: 'success',
        message: `Saved "${playlist.title}" to library`,
      });
    } catch (error) {
      console.error('Failed to save playlist to library', error);
      showToast({
        variant: 'error',
        message: `Could not save "${playlist.title}"`,
      });
    }
  };

  const handleRemoveFromLibrary = async () => {
    if (isProtected) return;

    try {
      const result = onRemoveFromLibrary
        ? await onRemoveFromLibrary(playlist)
        : await removePlaylistFromLibrary(playlist.id);

      if (result === false) return;

      setIsSaved(false);
      showToast({
        variant: 'success',
        message: `Removed "${playlist.title}" from library`,
      });
    } catch (error) {
      console.error('Failed to remove playlist from library', error);
      showToast({
        variant: 'error',
        message: `Could not remove "${playlist.title}"`,
      });
    }
  };

  const handleDownload = async () => {
    if (onDownload) {
      onDownload(playlist);
      return;
    }
    try {
      showToast({ variant: 'success', message: `Downloading "${playlist.title}"` });
      await downloadPlaylist(playlist);
    } catch (error) {
      console.error('Failed to download playlist', error);
      showToast({ variant: 'error', message: `Could not download "${playlist.title}"` });
    }
  };

  const runMenuAction = async (
    event: React.MouseEvent,
    action: () => void | Promise<void>,
  ) => {
    event.stopPropagation();
    await action();
    setShowMenu(false);
  };

  const renderMenu = () => {
    if (!showMenu || !menuAnchor) return null;

    return (
      <AnchoredPortalMenu
        anchor={menuAnchor}
        onClose={() => setShowMenu(false)}
        className="z-50 w-52 rounded-xl border border-chrome-neutral-800 bg-surface-container-high py-1.5"
      >
        {!isProtected && (isSaved ? (
          <button
            type="button"
            onClick={(event) => void runMenuAction(event, handleRemoveFromLibrary)}
            className="flex w-full items-center gap-3 px-3.5 py-2.5 text-sm text-chrome-neutral-300 transition-colors hover:bg-surface-container-highest hover:text-chrome-neutral-100"
          >
            <Trash2 size={16} />
            Remove from library
          </button>
        ) : (
          <button
            type="button"
            onClick={(event) => void runMenuAction(event, handleSaveToLibrary)}
            className="flex w-full items-center gap-3 px-3.5 py-2.5 text-sm text-chrome-neutral-300 transition-colors hover:bg-surface-container-highest hover:text-chrome-neutral-100"
          >
            <Plus size={16} />
            Save to library
          </button>
        ))}
        <button
          type="button"
          onClick={(event) => void runMenuAction(event, handleDownload)}
          className="flex w-full items-center gap-3 px-3.5 py-2.5 text-sm text-chrome-neutral-300 transition-colors hover:bg-surface-container-highest hover:text-chrome-neutral-100"
        >
          <Download size={16} />
          Download
        </button>
      </AnchoredPortalMenu>
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
            {playlist.description || 'View full playlist'}
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
