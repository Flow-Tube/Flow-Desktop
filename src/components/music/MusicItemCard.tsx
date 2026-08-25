import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Disc3, Download, Heart, Library, ListPlus, MoreVertical, Music2, Play, Share2 } from 'lucide-react';
import type { AlbumItem, ArtistItem, EpisodeItem, PlaylistItem, PodcastItem, SongItem } from '../../types/music';
import { getString } from '../../lib/i18n/index';
import { useActiveDownloadForVideo, useIsDownloaded } from '../../lib/useDownloads';
import { downloadAlbum, useCollectionDownloadState } from '../../lib/useCollectionDownloads';
import { upgradeAvatarUrl, upgradeMusicImageUrl } from '../../lib/thumbnails';
import { extractDominantColorFromImage, useDominantColor } from '../../lib/useDominantColor';
import { ColorWash, COLOR_WASH_HOST } from '../ui/ColorWash';
import { useHoverWashColor } from '../../lib/useHoverWashColor';
import { useMusicPlayerStore } from '../../store/useMusicPlayerStore';
import { useAlbumLibraryStore } from '../../store/useAlbumLibraryStore';
import { useLikesStore } from '../../store/useLikesStore';
import { useUiStore } from '../../store/useUiStore';
import { useProxiedImageUrl } from '../../lib/useProxiedImageUrl';
import { PlayingWave } from './PlayingWave';
import { MusicCardMenu, type MusicMenuAction, useMusicContextMenu } from './MusicCardMenu';
import { useTrackBlockActions } from './useTrackBlockActions';
import { useTrackNavActions } from './useTrackNavActions';
import { useTrackDownloadAction } from './useTrackDownloadAction';

type BaseProps = {
  className?: string;
  onPlay?: () => void;
  onOpen?: () => void;
  fill?: boolean;
};

export type MusicItemCardProps = BaseProps &
  (
    | { variant: 'album'; item: AlbumItem }
    | { variant: 'playlist'; item: PlaylistItem }
    | { variant: 'song'; item: SongItem }
    | { variant: 'video'; item: SongItem }
    | { variant: 'artist'; item: ArtistItem }
    | { variant: 'podcast'; item: PodcastItem }
    | { variant: 'episode'; item: EpisodeItem }
    | {
        variant: 'track-list';
        item: SongItem;
        onMenu?: () => void;
        appendActions?: MusicMenuAction[];
      }
  );

// --- helpers --------------------------------------------------------------

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return '';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function artistsText(artists?: { name: string }[] | null): string {
  if (!artists?.length) return '';
  return artists.map((a) => a.name).filter(Boolean).join(', ');
}

function videoIdOf(track: SongItem): string {
  return track.videoId ?? track.id;
}

/** Circular loader while a track downloads; a small "saved" badge once it is downloaded. */
function TrackDownloadIndicator({ trackId }: { trackId: string }) {
  const active = useActiveDownloadForVideo(trackId);
  const downloaded = useIsDownloaded(trackId);

  if (active) {
    const circumference = 2 * Math.PI * 7;
    const percent = active.totalBytes
      ? Math.max(0, Math.min(100, (active.downloadedBytes / active.totalBytes) * 100))
      : null;
    return (
      <span
        title={getString('download_downloading_tracks')}
        className="relative grid h-7 w-7 shrink-0 place-items-center text-[var(--color-primary)]"
      >
        <svg
          viewBox="0 0 18 18"
          className={cx('absolute inset-0 h-full w-full', percent == null && 'animate-spin')}
        >
          <circle cx="9" cy="9" r="7" fill="none" strokeWidth="2" className="stroke-chrome-neutral-700" />
          <circle
            cx="9"
            cy="9"
            r="7"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            stroke="currentColor"
            transform="rotate(-90 9 9)"
            strokeDasharray={circumference}
            strokeDashoffset={percent == null ? circumference * 0.65 : circumference * (1 - percent / 100)}
            className={percent == null ? undefined : 'transition-[stroke-dashoffset] duration-200'}
          />
        </svg>
        <Download className="h-3 w-3 animate-pulse" />
      </span>
    );
  }

  if (downloaded) {
    return (
      <span title={getString('downloaded')} className="shrink-0 text-[var(--color-primary)]">
        <CheckCircle2 className="h-4 w-4" />
      </span>
    );
  }

  return null;
}

function useSongLike(track: SongItem | null | undefined) {
  const likedItems = useLikesStore((s) => s.items);
  const loaded = useLikesStore((s) => s.loaded);
  const load = useLikesStore((s) => s.load);
  const toggleSong = useLikesStore((s) => s.toggleSong);
  const showToast = useUiStore((s) => s.showToast);

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  const trackId = track ? videoIdOf(track) : "";
  const liked = Boolean(
    track && likedItems.some((item) => item.kind === "music" && item.id === trackId),
  );

  const toggle = async () => {
    if (!track) return;
    try {
      const nowLiked = await toggleSong(track);
      showToast({
        variant: "success",
        message: getString(nowLiked ? "liked_added_toast" : "liked_removed_toast"),
      });
    } catch (error) {
      console.warn("Failed to update song like", error);
      showToast({ variant: "error", message: getString("liked_update_failed") });
    }
  };

  return { liked, toggle };
}

function albumSubtitle(item: AlbumItem): string {
  const artists = artistsText(item.artists);
  if (artists && item.year) return `${artists} • ${item.year}`;
  return artists || (item.year ? String(item.year) : '');
}

function playlistSubtitle(item: PlaylistItem): string {
  return item.author?.name || item.songCountText || '';
}

function podcastSubtitle(item: PodcastItem): string {
  return item.author?.name || item.episodeCountText || '';
}

function episodeSubtitle(item: EpisodeItem): string {
  const author = item.author?.name;
  if (author && item.publishDateText) return `${author} • ${item.publishDateText}`;
  return author || item.publishDateText || '';
}

function onKey(handler?: () => void) {
  return (e: React.KeyboardEvent) => {
    if (handler && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      handler();
    }
  };
}

function trackShareUrl(track: SongItem): string {
  return `https://music.youtube.com/watch?v=${encodeURIComponent(videoIdOf(track))}`;
}

function albumShareUrl(album: AlbumItem): string {
  return `https://music.youtube.com/browse/${encodeURIComponent(album.browseId)}`;
}

async function shareUrl(title: string, url: string) {
  try {
    if (navigator.share) {
      await navigator.share({ title, url });
      return;
    }
    await navigator.clipboard?.writeText(url);
  } catch {
    // Share/copy can be cancelled by the user; the menu should still close.
  }
}

// --- shared sub-components ------------------------------------------------

function Artwork({
  src,
  alt,
  rounded,
  className,
  iconSize = 'w-6 h-6',
  onLoad,
  imageRef,
}: {
  src?: string | null;
  alt: string;
  rounded: string;
  className?: string;
  iconSize?: string;
  onLoad?: (img: HTMLImageElement) => void;
  imageRef?: React.Ref<HTMLImageElement>;
}) {
  const [failed, setFailed] = useState(false);
  const upgradedSrc = rounded.includes('full') ? upgradeAvatarUrl(src) : upgradeMusicImageUrl(src);
  const imageSrc = useProxiedImageUrl(upgradedSrc);
  useEffect(() => setFailed(false), [imageSrc]);
  if (!imageSrc || failed) {
    return (
      <div
        className={cx(
          'grid place-items-center bg-surface-container-high text-chrome-neutral-500',
          rounded,
          className,
        )}
        aria-hidden
      >
        <Music2 className={iconSize} />
      </div>
    );
  }
  return (
    <img
      ref={imageRef}
      src={imageSrc}
      alt={alt}
      loading="lazy"
      onLoad={(event) => onLoad?.(event.currentTarget)}
      onError={() => setFailed(true)}
      className={cx('object-cover', rounded, className)}
    />
  );
}

function ExplicitBadge() {
  const label = getString('music_explicit');
  return (
    <span
      title={label}
      aria-label={label}
      className="grid h-4 w-4 shrink-0 place-items-center rounded-[3px] bg-chrome-neutral-700 text-[10px] font-bold leading-none text-chrome-neutral-300"
    >
      E
    </span>
  );
}

// --- variant renderers ----------------------------------------------------

/** Variant A — square card for albums & playlists. */
function SquareCard({
  item,
  menuKind,
  title,
  subtitle,
  thumbnail,
  onPlay,
  onOpen,
  className,
  fill,
}: {
  item?: AlbumItem | SongItem;
  menuKind?: 'album' | 'track';
  title: string;
  subtitle: string;
  thumbnail?: string | null;
  onPlay?: () => void;
  onOpen?: () => void;
  className?: string;
  fill?: boolean;
}) {
  const addToQueue = useMusicPlayerStore((s) => s.addToQueue);
  const playNextInQueue = useMusicPlayerStore((s) => s.playNextInQueue);
  const menu = useMusicContextMenu(Boolean(menuKind));
  const isTrack = menuKind === 'track' && item && 'videoId' in item;
  const isAlbum = menuKind === 'album' && item && 'browseId' in item;
  const songLike = useSongLike(isTrack ? item : null);
  const navActions = useTrackNavActions(isTrack ? item : null);
  const downloadActions = useTrackDownloadAction(isTrack ? item : null);
  const blockActions = useTrackBlockActions(isTrack ? item : null);

  const albumBrowseId = isAlbum ? item.browseId : null;
  const albumSaved = useAlbumLibraryStore((s) => (albumBrowseId ? s.isSaved(albumBrowseId) : false));
  const toggleAlbumLibrary = useAlbumLibraryStore((s) => s.toggle);
  const openAddToAlbum = useAlbumLibraryStore((s) => s.openAddToAlbum);
  const showToast = useUiStore((s) => s.showToast);
  const albumDownload = useCollectionDownloadState(albumBrowseId ?? undefined, "album");
  const washSrc = useProxiedImageUrl(upgradeMusicImageUrl(thumbnail, 320));
  const wash = useHoverWashColor(washSrc);
  const menuActions: MusicMenuAction[] = isTrack
    ? [
        {
          id: 'add-to-queue',
          label: getString('music_add_to_queue'),
          icon: <ListPlus size={16} />,
          onSelect: () => addToQueue(item),
        },
        {
          id: 'play-next',
          label: getString('music_play_next'),
          icon: <Play size={16} />,
          onSelect: () => playNextInQueue(item),
        },
        ...navActions,
        {
          id: 'add-to-album',
          label: getString('music_add_to_album'),
          icon: <Disc3 size={16} />,
          onSelect: () => openAddToAlbum(item),
        },
        ...downloadActions,
        {
          id: 'share',
          label: getString('music_share'),
          icon: <Share2 size={16} />,
          onSelect: () => shareUrl(item.title, trackShareUrl(item)),
        },
        ...blockActions,
      ]
    : isAlbum
      ? [
          {
            id: 'add-to-library',
            label: getString(albumSaved ? 'music_remove_from_library' : 'music_add_to_library'),
            icon: <Library size={16} />,
            onSelect: async () => {
              const nowSaved = await toggleAlbumLibrary(item);
              showToast({
                variant: 'success',
                message: getString(nowSaved ? 'music_saved_to_library' : 'music_removed_from_library'),
              });
            },
          },
          {
            id: 'download-album',
            label: albumDownload.isComplete
              ? getString('downloaded')
              : albumDownload.active
                ? getString('downloads_downloading')
                : getString('downloads_download_album'),
            icon:
              albumDownload.isComplete ? <CheckCircle2 size={16} /> : <Download size={16} />,
            onSelect: async () => {
              if (albumDownload.active) return;
              try {
                showToast({ variant: 'success', message: getString('download_started') });
                await downloadAlbum(item);
              } catch (error) {
                console.error('Failed to download album', error);
                showToast({ variant: 'error', message: getString('download_failed') });
              }
            },
          },
          {
            id: 'share',
            label: getString('music_share'),
            icon: <Share2 size={16} />,
            onSelect: () => shareUrl(item.title, albumShareUrl(item)),
          },
        ]
      : [];

  return (
    <div
      ref={menu.cardRef}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKey(onOpen)}
      onContextMenu={menu.openMenuFromContext}
      onMouseEnter={wash.onMouseEnter}
      onMouseLeave={wash.onMouseLeave}
      className={cx(
        `group ${COLOR_WASH_HOST} flex cursor-pointer flex-col gap-3`,
        fill ? 'w-full' : 'w-40 md:w-48 lg:w-56',
        'rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
        className,
      )}
    >
      <ColorWash active={wash.isHovered} color={wash.color} radius="rounded-2xl" bleed={6} />
      <div className="relative w-full aspect-square">
        <Artwork
          src={thumbnail}
          alt={title}
          rounded="rounded-xl"
          className="h-full w-full ring-1 ring-chrome-neutral-800/50"
          iconSize="w-10 h-10"
        />
        {isTrack ? (
          <button
            type="button"
            aria-label={getString('music_like_track')}
            aria-pressed={songLike.liked}
            onClick={(event) => {
              event.stopPropagation();
              void songLike.toggle();
            }}
            className={cx(
              'absolute left-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-chrome-black/80 text-chrome-white opacity-0 transition-all duration-200 ease-out hover:bg-chrome-black group-hover:opacity-100',
              songLike.liked ? 'text-[var(--color-primary)] opacity-100' : null,
            )}
          >
            <Heart className="h-4 w-4" fill={songLike.liked ? 'currentColor' : 'none'} />
          </button>
        ) : null}
        {menuKind ? (
          <div className="absolute right-2 top-2">
            <button
              type="button"
              aria-label={getString('music_more_options')}
              onClick={menu.openMenuFromDots}
              className="grid h-9 w-9 place-items-center rounded-full bg-chrome-black/80 text-chrome-white opacity-0 transition-all duration-200 ease-out hover:bg-chrome-black group-hover:opacity-100"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        <button
          type="button"
          aria-label={getString('music_play')}
          onClick={(e) => {
            e.stopPropagation();
            onPlay?.();
          }}
          className="absolute bottom-2 right-2 grid translate-y-1 place-items-center rounded-full bg-[var(--color-primary)] p-3 text-[var(--color-on-primary)] opacity-0 transition-all duration-200 ease-out group-hover:translate-y-0 group-hover:opacity-100 hover:scale-105"
        >
          <Play className="h-5 w-5" fill="currentColor" />
        </button>
      </div>
      <MusicCardMenu
        actions={menuActions}
        anchor={menu.anchor}
        onClose={menu.closeMenu}
        show={menu.showMenu}
      />
      <div className="flex flex-col gap-0.5">
        <span className="line-clamp-1 font-medium text-chrome-neutral-100">{title}</span>
        {subtitle && <span className="line-clamp-1 text-sm text-chrome-neutral-400">{subtitle}</span>}
      </div>
    </div>
  );
}

/** Variant D — 16:9 card for music videos (distinct from square album art). */
function VideoCard16x9({
  title,
  subtitle,
  thumbnail,
  onPlay,
  onOpen,
  className,
  fill,
}: {
  title: string;
  subtitle: string;
  thumbnail?: string | null;
  onPlay?: () => void;
  onOpen?: () => void;
  className?: string;
  fill?: boolean;
}) {
  const washSrc = useProxiedImageUrl(upgradeMusicImageUrl(thumbnail, 480));
  const wash = useHoverWashColor(washSrc);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen ?? onPlay}
      onKeyDown={onKey(onOpen ?? onPlay)}
      onMouseEnter={wash.onMouseEnter}
      onMouseLeave={wash.onMouseLeave}
      className={cx(
        `group ${COLOR_WASH_HOST} flex cursor-pointer flex-col gap-3`,
        fill ? 'w-full' : 'w-[260px] md:w-[300px]',
        'rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
        className,
      )}
    >
      <ColorWash active={wash.isHovered} color={wash.color} radius="rounded-2xl" bleed={6} />
      <div className="relative aspect-video w-full">
        <Artwork
          src={thumbnail}
          alt={title}
          rounded="rounded-xl"
          className="h-full w-full ring-1 ring-chrome-neutral-800/50"
          iconSize="w-10 h-10"
        />
        <button
          type="button"
          aria-label={getString('music_play')}
          onClick={(e) => {
            e.stopPropagation();
            onPlay?.();
          }}
          className="absolute bottom-2 right-2 grid translate-y-1 place-items-center rounded-full bg-[var(--color-primary)] p-3 text-[var(--color-on-primary)] opacity-0 transition-all duration-200 ease-out group-hover:translate-y-0 group-hover:opacity-100 hover:scale-105"
        >
          <Play className="h-5 w-5" fill="currentColor" />
        </button>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="line-clamp-2 font-medium text-chrome-neutral-100">{title}</span>
        {subtitle && <span className="line-clamp-1 text-sm text-chrome-neutral-400">{subtitle}</span>}
      </div>
    </div>
  );
}

/** Variant B — circular card for artists. */
function CircleCard({
  title,
  thumbnail,
  onOpen,
  className,
  fill,
}: {
  title: string;
  thumbnail?: string | null;
  onOpen?: () => void;
  className?: string;
  fill?: boolean;
}) {
  const washSrc = useProxiedImageUrl(upgradeAvatarUrl(thumbnail));
  const wash = useHoverWashColor(washSrc);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKey(onOpen)}
      onMouseEnter={wash.onMouseEnter}
      onMouseLeave={wash.onMouseLeave}
      className={cx(
        `group ${COLOR_WASH_HOST} flex cursor-pointer flex-col items-center gap-3 text-center`,
        fill ? 'w-full' : 'w-32 md:w-40',
        'rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
        className,
      )}
    >
      <ColorWash active={wash.isHovered} color={wash.color} radius="rounded-2xl" bleed={6} />
      <div className={cx('aspect-square shrink-0', fill ? 'w-full' : 'w-32 md:w-40')}>
        <Artwork
          src={thumbnail}
          alt={title}
          rounded="rounded-full"
          className="h-full w-full ring-1 ring-chrome-neutral-800/50 transition-transform duration-200 ease-out group-hover:scale-[1.02]"
          iconSize="w-10 h-10"
        />
      </div>
      <span className="line-clamp-2 text-center font-medium text-chrome-neutral-100">{title}</span>
    </div>
  );
}

/** Variant C — dense list row for tracks (Spotify "Top Tracks" style). */
function ListRow({
  item,
  onPlay,
  onMenu,
  appendActions,
  className,
}: {
  item: SongItem;
  onPlay?: () => void;
  onMenu?: () => void;
  appendActions?: MusicMenuAction[];
  className?: string;
}) {
  const trackId = videoIdOf(item);
  const title = item.title;
  const subtitle = artistsText(item.artists);
  const duration = formatDuration(item.duration);
  const explicit = item.explicit;
  const [isHovered, setIsHovered] = useState(false);
  const songLike = useSongLike(item);
  const [dominantColor, setDominantColor] = useState<{ r: number; g: number; b: number } | null>(null);
  const artworkRef = useRef<HTMLImageElement | null>(null);
  const colorImageSrc = useProxiedImageUrl(upgradeMusicImageUrl(item.thumbnail, 320));
  const preloadedColor = useDominantColor(colorImageSrc);
  const addToQueue = useMusicPlayerStore((s) => s.addToQueue);
  const playNextInQueue = useMusicPlayerStore((s) => s.playNextInQueue);
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const playerIsPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const openAddToAlbum = useAlbumLibraryStore((s) => s.openAddToAlbum);
  const navActions = useTrackNavActions(item);
  const downloadActions = useTrackDownloadAction(item);
  const blockActions = useTrackBlockActions(item);
  const menu = useMusicContextMenu(true);
  const isPlayingTrack = !!currentTrack && videoIdOf(currentTrack) === trackId && playerIsPlaying;
  const isHighlighted = isHovered || isPlayingTrack;
  const activeColor = dominantColor ?? preloadedColor;
  const menuActions: MusicMenuAction[] = [
    {
      id: 'add-to-queue',
      label: getString('music_add_to_queue'),
      icon: <ListPlus size={16} />,
      onSelect: () => {
        if (onMenu) onMenu();
        else addToQueue(item);
      },
    },
    {
      id: 'play-next',
      label: getString('music_play_next'),
      icon: <Play size={16} />,
      onSelect: () => playNextInQueue(item),
    },
    ...navActions,
    {
      id: 'add-to-album',
      label: getString('music_add_to_album'),
      icon: <Disc3 size={16} />,
      onSelect: () => openAddToAlbum(item),
    },
    ...downloadActions,
    {
      id: 'share',
      label: getString('music_share'),
      icon: <Share2 size={16} />,
      onSelect: () => shareUrl(title, trackShareUrl(item)),
    },
    ...blockActions,
    ...(appendActions ?? []),
  ];
  const resolveColor = (img?: HTMLImageElement) => {
    const source = img ?? artworkRef.current;
    if (!source || !source.complete || source.naturalWidth === 0) {
      return;
    }
    const extracted = extractDominantColorFromImage(source);
    setDominantColor(extracted ?? preloadedColor);
  };

  useEffect(() => {
    if (isPlayingTrack) resolveColor();
  }, [isPlayingTrack]);

  useEffect(() => {
    setDominantColor(null);
  }, [colorImageSrc]);

  return (
    <div
      ref={menu.cardRef}
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={onKey(onPlay)}
      onContextMenu={menu.openMenuFromContext}
      onMouseEnter={() => {
        setIsHovered(true);
        resolveColor();
      }}
      onMouseLeave={() => setIsHovered(false)}
      className={cx(
        `group ${COLOR_WASH_HOST} flex w-full cursor-pointer items-center gap-4 rounded-lg p-2`,
        'outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
        className,
      )}
    >
      <ColorWash active={isHighlighted} color={activeColor} radius="rounded-lg" spread="row" />
      <div className="relative h-12 w-12 shrink-0">
        <Artwork
          src={item.thumbnail}
          alt={title}
          rounded="rounded-md"
          className="h-full w-full"
          iconSize="w-5 h-5"
          imageRef={artworkRef}
          onLoad={(img) => {
            if (isHighlighted) resolveColor(img);
          }}
        />
        <div
          className={cx(
            'absolute inset-0 grid place-items-center rounded-md bg-chrome-black/60 transition-opacity duration-200 ease-out',
            isPlayingTrack ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          {isPlayingTrack ? (
            <PlayingWave className="text-chrome-white" />
          ) : (
            <Play className="h-5 w-5 text-chrome-white" fill="currentColor" />
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className={cx('line-clamp-1 font-medium', isPlayingTrack ? 'text-chrome-neutral-50' : 'text-chrome-neutral-100')}>
          {title}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          {explicit && <ExplicitBadge />}
          {subtitle && <span className="line-clamp-1 text-sm text-chrome-neutral-400">{subtitle}</span>}
        </span>
      </div>

      <div className="relative h-8 w-24 shrink-0">
        <span className="absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-1.5 transition-opacity duration-200 ease-out group-hover:opacity-0">
          <TrackDownloadIndicator trackId={trackId} />
          {duration && (
            <span className="font-mono text-sm tabular-nums text-chrome-neutral-400">{duration}</span>
          )}
        </span>
        <div className="absolute right-0 top-0 flex items-center gap-1 opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100">
          <button
            type="button"
            aria-label={getString('music_like_track')}
            aria-pressed={songLike.liked}
            onClick={(event) => {
              event.stopPropagation();
              void songLike.toggle();
            }}
            className={cx(
              'grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100',
              songLike.liked ? 'text-[var(--color-primary)]' : null,
            )}
          >
            <Heart className="h-4 w-4" fill={songLike.liked ? 'currentColor' : 'none'} />
          </button>
          <div className="relative">
            <button
              type="button"
              aria-label={getString('music_more_options')}
              onClick={menu.openMenuFromDots}
              className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      <MusicCardMenu
        actions={menuActions}
        anchor={menu.anchor}
        onClose={menu.closeMenu}
        show={menu.showMenu}
      />
    </div>
  );
}

// --- public component -----------------------------------------------------

export function MusicItemCard(props: MusicItemCardProps) {
  const { className, onPlay, onOpen, fill } = props;

  switch (props.variant) {
    case 'album':
      return (
        <SquareCard
          item={props.item}
          menuKind="album"
          title={props.item.title}
          subtitle={albumSubtitle(props.item)}
          thumbnail={props.item.thumbnail}
          onPlay={onPlay}
          onOpen={onOpen}
          className={className}
          fill={fill}
        />
      );
    case 'playlist':
      return (
        <SquareCard
          title={props.item.title}
          subtitle={playlistSubtitle(props.item)}
          thumbnail={props.item.thumbnail}
          onPlay={onPlay}
          onOpen={onOpen}
          className={className}
          fill={fill}
        />
      );
    case 'song':
      return (
        <SquareCard
          item={props.item}
          menuKind="track"
          title={props.item.title}
          subtitle={artistsText(props.item.artists)}
          thumbnail={props.item.thumbnail}
          onPlay={onPlay}
          onOpen={onOpen ?? onPlay}
          className={className}
          fill={fill}
        />
      );
    case 'video':
      return (
        <VideoCard16x9
          title={props.item.title}
          subtitle={artistsText(props.item.artists)}
          thumbnail={props.item.thumbnail}
          onPlay={onPlay}
          onOpen={onOpen}
          className={className}
          fill={fill}
        />
      );
    case 'artist':
      return (
        <CircleCard
          title={props.item.title}
          thumbnail={props.item.thumbnail}
          onOpen={onOpen}
          className={className}
          fill={fill}
        />
      );
    case 'podcast':
      return (
        <SquareCard
          title={props.item.title}
          subtitle={podcastSubtitle(props.item)}
          thumbnail={props.item.thumbnail}
          onPlay={onPlay}
          onOpen={onOpen}
          className={className}
          fill={fill}
        />
      );
    case 'episode':
      return (
        <SquareCard
          title={props.item.title}
          subtitle={episodeSubtitle(props.item)}
          thumbnail={props.item.thumbnail}
          onPlay={onPlay}
          onOpen={onOpen ?? onPlay}
          className={className}
          fill={fill}
        />
      );
    case 'track-list':
      return (
        <ListRow
          item={props.item}
          onPlay={onPlay}
          onMenu={props.onMenu}
          appendActions={props.appendActions}
          className={className}
        />
      );
  }
}

export default MusicItemCard;
