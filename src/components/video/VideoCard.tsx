import { useNavigate } from 'react-router-dom';
import { useSubscriptionStore } from '../../store/useSubscriptionStore';
import { useFeedActionsStore } from '../../store/useFeedActionsStore';
import { useLiveStore } from '../../store/useLiveStore';
import { Plus, Ban, Check, MoreVertical, Trash2, GripHorizontal, Sparkles, Eye, EyeOff, Clock, ListPlus, Download, User } from 'lucide-react';
import type { VideoSummary } from '../../types/video';
import { Button } from '../ui/Button';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useDeArrowOverride } from '../../lib/useDeArrowOverride';
import { getVideoDetails } from '../../lib/api/youtube';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useAppSettingsStore } from '../../store/useAppSettingsStore';
import { useChannelAvatar } from '../../lib/useChannelAvatar';
import { isUnavailableYoutubeThumbnail, resolveYoutubeThumbnailCandidates, upgradeAvatarUrl } from '../../lib/thumbnails';
import { IS_LINUX_RUNTIME } from '../../lib/platform';
import { useProxiedImageUrl } from '../../lib/useProxiedImageUrl';
import { SETTINGS } from '../../lib/settings/schema';
import { AnchoredPortalMenu, type MenuAnchor } from '../ui/AnchoredPortalMenu';
import { getString } from '../../lib/i18n/index';
import { useWatchLaterStore } from '../../store/useWatchLaterStore';
import { useUiStore } from '../../store/useUiStore';
import { usePlaylistModalStore } from '../../store/usePlaylistModalStore';
import { usePlayerStore } from '../../store/usePlayerStore';
import { useDownloadStore } from '../../store/useDownloadStore';
import { useDownloadsLibraryStore } from '../../store/useDownloadsLibraryStore';
import { findDownloadedRecord, useIsDownloaded } from '../../lib/useDownloads';
import { extractDominantColorFromImage, type Rgb } from '../../lib/useDominantColor';
import { ColorWash, COLOR_WASH_HOST } from '../ui/ColorWash';

export interface VideoCardProps {
  video: VideoSummary;
  onPlay: (video: VideoSummary) => void;
  onAddToQueue?: (video: VideoSummary) => void;
  onRemoveFromHistory?: (videoId: string) => void;
  onRemoveFromContinueWatching?: (videoId: string) => void;
  variant?: 'default' | 'grid' | 'history' | 'continue' | 'list' | 'compact';
  hideChannelAvatar?: boolean;
  showDragHandle?: boolean;
  dragHandleProps?: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    ref?: React.Ref<HTMLButtonElement>;
  };
  isDragActive?: boolean;
}

function formatDuration(seconds?: number | null) {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function LiveBadge({ className }: { className?: string }) {
  return (
    <div
      className={`z-10 flex items-center gap-1 rounded bg-primary px-1 py-px text-[11px] font-bold uppercase leading-tight tracking-wide text-on-primary ${className || ''}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
      Live
    </div>
  );
}

function getTitleClampStyle(maxLines: string | undefined): React.CSSProperties | undefined {
  const lines = Number(maxLines ?? '1');
  if (!Number.isFinite(lines) || lines <= 0) return undefined;
  return {
    display: '-webkit-box',
    WebkitLineClamp: Math.max(1, Math.min(3, Math.trunc(lines))),
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  };
}

function VideoCardComponent({
  video,
  onPlay,
  onAddToQueue,
  onRemoveFromHistory,
  onRemoveFromContinueWatching,
  variant = 'default',
  hideChannelAvatar,
  showDragHandle = true,
  dragHandleProps,
  isDragActive = false,
}: VideoCardProps) {
  const navigate = useNavigate();
  const subscribe = useSubscriptionStore((s) => s.subscribe);
  const unsubscribe = useSubscriptionStore((s) => s.unsubscribe);
  const notInterested = useFeedActionsStore((s) => s.notInterested);
  const blockChannelAction = useFeedActionsStore((s) => s.blockChannel);
  const markWatched = useFeedActionsStore((s) => s.markWatched);
  const moreLikeThis = useFeedActionsStore((s) => s.moreLikeThis);
  const showToast = useUiStore((s) => s.showToast);
  const openAddToPlaylist = usePlaylistModalStore((s) => s.openAddToPlaylist);
  const openVideoDownload = useDownloadStore((s) => s.openVideo);
  const removeDownloads = useDownloadsLibraryStore((s) => s.remove);
  const isDownloaded = useIsDownloaded(video.id);
  const [showMenu, setShowMenu] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [dominantColor, setDominantColor] = useState<Rgb | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [thumbnailCandidateIndex, setThumbnailCandidateIndex] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const thumbnailRef = useRef<HTMLImageElement>(null);

  const isChannel = video.id.startsWith("channel:");
  const cleanId = isChannel ? video.id.replace("channel:", "") : video.id;
  const channelId = video.channelId || "";

  const markLive = useLiveStore((s) => s.markLive);
  const liveFromStore = useLiveStore((s) => s.liveIds.has(video.id));
  const isLiveVideo = !!video.isLive || liveFromStore;

  useEffect(() => {
    if (video.isLive) markLive(video.id);
  }, [video.id, video.isLive, markLive]);

  // A synchronous lookup against the shared set. Resolving this per card cost an
  // IPC round trip plus a parse of the whole playlist library, several hundred
  // times over, to label a single context-menu entry.
  const isSavedToWatchLater = useWatchLaterStore((s) => s.ids.has(video.id));
  const saveToWatchLater = useWatchLaterStore((s) => s.add);
  const removeFromWatchLater = useWatchLaterStore((s) => s.remove);

  const dearrowEnabled = useSettingsStore((s) => s.dearrowEnabled);
  const titleClampStyle = getTitleClampStyle(
    useAppSettingsStore((state) => state.values[SETTINGS.VIDEO_TITLE_MAX_LINES])
  );

  // Only resolve via the hook when the feed didn't already supply an avatar —
  // the hook falls back to a getChannelDetails() network fetch per unknown
  // channel, which multiplied across a large feed floods the backend.
  const hookAvatarUrl = useChannelAvatar(
    isChannel || video.channelAvatarUrl ? null : channelId || null,
  );
  const resolvedAvatarUrl = useProxiedImageUrl(upgradeAvatarUrl(video.channelAvatarUrl || hookAvatarUrl));
  const channelCardAvatarUrl = useProxiedImageUrl(upgradeAvatarUrl(video.thumbnailUrl));
  // Cached and de-duplicated across cards and remounts by the hook; this used to
  // be a bare `getDeArrowOverride` in an effect, one IPC per card, every mount.
  const dearrowOverride = useDeArrowOverride(isChannel ? null : video.id, dearrowEnabled);
  const overriddenTitle = dearrowOverride?.title || null;
  const overriddenThumbnail = dearrowOverride?.thumbnailUrl || null;

  const displayTitle = overriddenTitle || video.title;
  const thumbnailCandidates = resolveYoutubeThumbnailCandidates(video.id, overriddenThumbnail || video.thumbnailUrl);
  const displayThumbnail = thumbnailCandidates[thumbnailCandidateIndex] || overriddenThumbnail || video.thumbnailUrl;

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
    // getImageData is a synchronous pixel readback — cheap on GPU-composited
    // webviews, janky on Linux's CPU path (and it fires while the cursor
    // sweeps across cards mid-scroll). The color-mix fallback covers Linux.
    if (IS_LINUX_RUNTIME) return;
    const thumbnail = thumbnailRef.current;
    // `complete` alone is true for a broken image too — the same
    // `complete && naturalWidth` pair the music cards use.
    if (!dominantColor && thumbnail?.complete && thumbnail.naturalWidth > 0) {
      const color = extractDominantColorFromImage(thumbnail);
      if (color) {
        setDominantColor(color);
      }
    }
  }, [dominantColor]);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
  }, []);

  const handleThumbnailLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    if (
      isUnavailableYoutubeThumbnail(img) &&
      thumbnailCandidateIndex < thumbnailCandidates.length - 1
    ) {
      setThumbnailCandidateIndex((idx) => idx + 1);
      return;
    }

    if (!IS_LINUX_RUNTIME && isHovered && !dominantColor) {
      const color = extractDominantColorFromImage(img);
      if (color) {
        setDominantColor(color);
      }
    }
  }, [dominantColor, isHovered, thumbnailCandidateIndex, thumbnailCandidates.length]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (isChannel) return;
    e.preventDefault();
    e.stopPropagation();
    setMenuAnchor({ top: e.clientY, left: e.clientX });
    setShowMenu(true);
  }, [isChannel]);

  const openMenuFromDots = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuAnchor({ top: rect.bottom + 4, right: rect.right });
    setShowMenu((prev) => !prev);
  }, []);

  const subTargetId = isChannel ? cleanId : channelId;
  const subStatus = useSubscriptionStore((s) =>
    subTargetId ? s.subscriptions.some((c) => c.id === subTargetId) : false,
  );
  const isHistoryCard = variant === 'history';
  const isContinueCard = variant === 'continue';
  const isListVariant = variant === 'list';
  const progressPercent = Math.min(100, Math.max(0, video.watchProgressPercent ?? 0));

  useEffect(() => {
    setThumbnailCandidateIndex(0);
    setDominantColor(null);
  }, [overriddenThumbnail, video.id, video.thumbnailUrl]);

  const handleThumbnailError = useCallback(() => {
    setThumbnailCandidateIndex((idx) => Math.min(idx + 1, Math.max(0, thumbnailCandidates.length - 1)));
  }, [thumbnailCandidates.length]);

  const handleSubscribeToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const idToToggle = isChannel ? cleanId : channelId;
    if (!idToToggle) return;
    if (subStatus) {
      unsubscribe(idToToggle);
    } else {
      subscribe(idToToggle, isChannel ? video.title : video.channelName, video.thumbnailUrl || undefined);
    }
  };

  const handleRemoveFromHistory = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemoveFromHistory?.(video.id);
  };

  const handleChannelNavigate = useCallback(async (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    if (channelId) {
      navigate(`/channel/${channelId}`);
      return;
    }

    try {
      const details = await getVideoDetails(video.id);
      if (details.channelId) {
        navigate(`/channel/${details.channelId}`);
      }
    } catch (error) {
      console.warn("Failed to resolve channel for video card", error);
    }
  }, [channelId, navigate, video.id]);

  const handleRemoveFromContinueWatching = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemoveFromContinueWatching?.(video.id);
    setShowMenu(false);
  };

  const handleToggleWatchLater = async () => {
    try {
      if (isSavedToWatchLater) {
        await removeFromWatchLater(video.id);
        showToast({
          variant: "success",
          message: getString("video_removed_from_watch_later"),
        });
        return;
      }

      await saveToWatchLater(video);
      showToast({
        variant: "success",
        message: getString("video_saved_to_watch_later"),
      });
    } catch (error) {
      console.error("Failed to update Watch Later", error);
      showToast({
        variant: "error",
        message: getString("video_watch_later_failed"),
      });
    }
  };

  const handleAddToQueue = () => {
    const player = usePlayerStore.getState();
    const isDuplicate = player.currentVideo?.id === video.id
      || player.queue.some((item) => item.id === video.id);

    if (onAddToQueue) {
      onAddToQueue(video);
    } else {
      player.addToQueue(video);
    }

    showToast({
      variant: isDuplicate ? "info" : "success",
      message: getString(isDuplicate ? "queue_duplicate_toast" : "queue_added_toast"),
    });
  };

  const handleDownloadAction = async () => {
    if (!isDownloaded) {
      openVideoDownload(video);
      return;
    }
    const record = findDownloadedRecord(video.id, "video");
    if (!record) return;
    await removeDownloads([record.id]);
    showToast({
      variant: "success",
      message: getString("video_download_removed_toast"),
    });
  };

  // ── Menu dropdown ───
  const renderMenu = () => {
    if (!showMenu || !menuAnchor) return null;

    return (
      <AnchoredPortalMenu
        anchor={menuAnchor}
        onClose={() => setShowMenu(false)}
        className="z-50 w-60 rounded-xl border border-chrome-neutral-800 bg-surface-container-high py-1.5"
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleAddToQueue();
            setShowMenu(false);
          }}
          className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm text-chrome-zinc-300 hover:bg-chrome-zinc-800 hover:text-chrome-zinc-100 transition-colors"
        >
          <Plus size={16} />
          {getString("music_add_to_queue")}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openAddToPlaylist(video);
            setShowMenu(false);
          }}
          className="w-full flex items-center gap-3 whitespace-nowrap px-3.5 py-2.5 text-sm text-chrome-zinc-300 hover:bg-chrome-zinc-800 hover:text-chrome-zinc-100 transition-colors"
        >
          <ListPlus size={16} />
          {getString("video_add_to_playlist")}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handleChannelNavigate(e);
            setShowMenu(false);
          }}
          className="w-full flex items-center gap-3 whitespace-nowrap px-3.5 py-2.5 text-sm text-chrome-zinc-300 hover:bg-chrome-zinc-800 hover:text-chrome-zinc-100 transition-colors"
        >
          <User size={16} />
          {getString("video_view_channel")}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handleDownloadAction();
            setShowMenu(false);
          }}
          className="w-full flex items-center gap-3 whitespace-nowrap px-3.5 py-2.5 text-sm text-chrome-zinc-300 hover:bg-chrome-zinc-800 hover:text-chrome-zinc-100 transition-colors"
        >
          {isDownloaded ? <Trash2 size={16} /> : <Download size={16} />}
          {getString(isDownloaded ? "video_remove_download" : "download")}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handleToggleWatchLater();
            setShowMenu(false);
          }}
          className="w-full flex items-center gap-3 whitespace-nowrap px-3.5 py-2.5 text-sm text-chrome-zinc-300 hover:bg-chrome-zinc-800 hover:text-chrome-zinc-100 transition-colors"
        >
          <Clock size={16} />
          {getString(isSavedToWatchLater ? "video_remove_from_watch_later" : "video_save_to_watch_later")}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            void moreLikeThis(video);
            setShowMenu(false);
          }}
          className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm text-chrome-zinc-300 hover:bg-chrome-zinc-800 hover:text-chrome-zinc-100 transition-colors"
        >
          <Sparkles size={16} />
          More like this
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            void markWatched(video);
            setShowMenu(false);
          }}
          className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm text-chrome-zinc-300 hover:bg-chrome-zinc-800 hover:text-chrome-zinc-100 transition-colors"
        >
          <Eye size={16} />
          Mark as watched
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            void notInterested(video);
            setShowMenu(false);
          }}
          className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm text-chrome-zinc-300 hover:bg-chrome-zinc-800 hover:text-chrome-zinc-100 transition-colors"
        >
          <Ban size={16} />
          Not interested
        </button>
        {onRemoveFromContinueWatching ? (
          <button
            onClick={handleRemoveFromContinueWatching}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm text-chrome-zinc-300 hover:bg-chrome-zinc-800 hover:text-chrome-zinc-100 transition-colors"
          >
            <Trash2 size={16} />
            {getString("video_remove_from_continue_watching")}
          </button>
        ) : null}
        {video.channelId && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              void blockChannelAction(video);
              setShowMenu(false);
            }}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm text-chrome-zinc-300 hover:bg-chrome-zinc-800 hover:text-chrome-zinc-100 transition-colors"
          >
            <EyeOff size={16} />
            Don't show this channel
          </button>
        )}
      </AnchoredPortalMenu>
    );
  };

  if (isChannel) {
    return (
      <div 
        onClick={() => navigate(`/channel/${cleanId}`)}
        className="flex flex-col items-center justify-center p-6 bg-surface rounded-xl border border-chrome-zinc-800 hover:bg-chrome-zinc-900/50 transition-colors group cursor-pointer"
      >
        <div className="w-24 h-24 rounded-full overflow-hidden mb-4 border border-chrome-zinc-800 group-hover:scale-105 transition-transform duration-300">
          {channelCardAvatarUrl ? (
            <img
              src={channelCardAvatarUrl}
              alt={video.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full bg-chrome-zinc-800 flex items-center justify-center text-xl font-bold text-chrome-zinc-400">
              {video.title.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <h3 className="font-bold text-center text-chrome-zinc-100 line-clamp-1 group-hover:text-primary transition-colors">
          {video.title}
        </h3>
        <p className="text-xs text-chrome-zinc-400 mb-4">{video.publishedText || "Channel"}</p>
        
        <Button
          variant={subStatus ? "secondary" : "primary"}
          size="sm"
          className="w-full"
          onClick={handleSubscribeToggle}
        >
          {subStatus ? (
            <span className="flex items-center gap-1.5"><Check size={14} /> Subscribed</span>
          ) : (
            <span className="flex items-center gap-1.5"><Plus size={14} /> Subscribe</span>
          )}
        </Button>
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div
        ref={cardRef}
        className={`group ${COLOR_WASH_HOST} flex w-full gap-2 rounded-xl p-1.5 -m-1.5`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenu}
      >
        <ColorWash active={isHovered} color={dominantColor} alpha={0.2} spread="row" />
        <div
          className="relative aspect-video w-40 shrink-0 cursor-pointer overflow-hidden rounded-xl bg-surface-container"
          onClick={() => onPlay(video)}
        >
          {displayThumbnail ? (
            <img
              ref={thumbnailRef}
              src={displayThumbnail}
              alt={displayTitle}
              className="h-full w-full object-cover"
              crossOrigin="anonymous"
              loading="lazy"
              decoding="async"
              onLoad={handleThumbnailLoad}
              onError={handleThumbnailError}
            />
          ) : (
            <div className="h-full w-full bg-chrome-zinc-800" />
          )}
          {isLiveVideo ? (
            <LiveBadge className="absolute bottom-1 right-1" />
          ) : video.durationSeconds ? (
            <div className="absolute bottom-1 right-1 z-10 rounded bg-chrome-black/80 px-1 py-px text-[11px] font-medium leading-tight text-chrome-white">
              {formatDuration(video.durationSeconds)}
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <h3
            onClick={() => onPlay(video)}
            style={titleClampStyle}
            className="cursor-pointer text-sm font-medium leading-snug text-chrome-neutral-100 transition-colors group-hover:text-primary"
          >
            {displayTitle}
          </h3>
          <button
            type="button"
            onClick={(e) => { void handleChannelNavigate(e); }}
            className="mt-1 truncate text-left text-[13px] text-chrome-neutral-400 transition-colors hover:text-chrome-neutral-300"
          >
            {video.channelName}
          </button>
          <div className="text-[13px] text-chrome-neutral-500">
            {video.viewCountText && <span>{video.viewCountText}</span>}
            {video.viewCountText && video.publishedText && <span className="mx-1">•</span>}
            {video.publishedText && <span>{video.publishedText}</span>}
          </div>
        </div>

        <div className="relative shrink-0">
          <button
            onClick={openMenuFromDots}
            className="rounded-full p-1 text-chrome-neutral-500 opacity-0 transition duration-150 ease-out hover:bg-chrome-neutral-800 hover:text-chrome-neutral-200 group-hover:opacity-100"
          >
            <MoreVertical size={18} />
          </button>
        </div>

        {renderMenu()}
      </div>
    );
  }

  if (isListVariant) {
    const {
      className: dragHandleClassName,
      style: dragHandleStyle,
      ...dragHandleRest
    } = dragHandleProps ?? {};

    return (
      <div
        ref={cardRef}
        className={`group ${COLOR_WASH_HOST} flex w-full flex-row items-center gap-4 rounded-xl px-1 py-2`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenu}
      >
        <ColorWash active={isHovered} color={dominantColor} alpha={0.2} spread="row" />
        {showDragHandle ? (
          <button
            type="button"
            aria-label="Reorder video"
            className={[
              'shrink-0 rounded-md p-1 text-chrome-neutral-500 transition-colors duration-200 ease-out',
              'hover:text-chrome-neutral-300',
              isDragActive ? 'cursor-grabbing' : 'cursor-grab',
              dragHandleClassName,
            ].filter(Boolean).join(' ')}
            style={dragHandleStyle}
            onClick={(e) => e.stopPropagation()}
            {...dragHandleRest}
          >
            <GripHorizontal size={20} strokeWidth={2.5} />
          </button>
        ) : (
          <div className="w-7 shrink-0" aria-hidden="true" />
        )}

        <div
          className="relative aspect-video w-40 shrink-0 cursor-pointer overflow-hidden rounded-xl bg-chrome-zinc-900 sm:w-48"
          onClick={() => onPlay(video)}
        >
          {displayThumbnail ? (
            <img
              ref={thumbnailRef}
              src={displayThumbnail}
              alt={displayTitle}
              className="h-full w-full object-cover"
              crossOrigin="anonymous"
              loading="lazy"
              decoding="async"
              onLoad={handleThumbnailLoad}
              onError={handleThumbnailError}
            />
          ) : (
            <div className="h-full w-full bg-chrome-zinc-800" />
          )}

          {isLiveVideo ? (
            <LiveBadge className="absolute bottom-1 right-1" />
          ) : video.durationSeconds ? (
            <div className="absolute bottom-1 right-1 z-10 rounded bg-chrome-black/80 px-1 py-px text-[12px] font-medium leading-tight tracking-wide text-chrome-white">
              {formatDuration(video.durationSeconds)}
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <h3
            onClick={() => onPlay(video)}
            style={titleClampStyle}
            className="cursor-pointer text-sm font-medium leading-snug text-chrome-neutral-100 transition-colors hover:text-[var(--color-primary)]"
          >
            {displayTitle}
          </h3>
          <button
            type="button"
            onClick={(e) => { void handleChannelNavigate(e); }}
            className="mt-0.5 truncate text-left text-[13px] text-chrome-neutral-400 transition-colors hover:text-chrome-neutral-300"
          >
            {video.channelName}
          </button>
          <div className="mt-0.5 text-[13px] text-chrome-neutral-500">
            {video.viewCountText && <span>{video.viewCountText}</span>}
            {video.viewCountText && video.publishedText && <span className="mx-1">•</span>}
            {video.publishedText && <span>{video.publishedText}</span>}
          </div>
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={openMenuFromDots}
            className="mt-0.5 rounded-full p-1 text-chrome-neutral-500 opacity-0 transition duration-150 ease-out hover:bg-chrome-neutral-800 hover:text-chrome-neutral-200 group-hover:opacity-100"
          >
            <MoreVertical size={18} />
          </button>
        </div>

        {renderMenu()}
      </div>
    );
  }

  const channelInitials = video.channelName?.substring(0, 1).toUpperCase() || '?';

  return (
    <div
      ref={cardRef}
      className={`video-card flex flex-col gap-3 group ${COLOR_WASH_HOST} rounded-xl p-1.5 -m-1.5`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu}
    >
      <ColorWash active={isHovered} color={dominantColor} alpha={0.2} />
      <div
        className="relative w-full aspect-video rounded-xl overflow-hidden bg-chrome-zinc-900 cursor-pointer"
        onClick={() => onPlay(video)}
      >
        {displayThumbnail ? (
          <img
            ref={thumbnailRef}
            src={displayThumbnail}
            alt={displayTitle}
            className={`w-full h-full object-cover${IS_LINUX_RUNTIME ? "" : " transition-transform duration-300 group-hover:scale-[1.03]"}`}
            crossOrigin="anonymous"
            loading="lazy"
            decoding="async"
            onLoad={handleThumbnailLoad}
            onError={handleThumbnailError}
          />
        ) : (
          <div className="w-full h-full bg-chrome-zinc-800" />
        )}

        {isLiveVideo ? (
          <LiveBadge className={`absolute right-1 ${isHistoryCard || isContinueCard ? 'bottom-2' : 'bottom-1'}`} />
        ) : video.durationSeconds ? (
          <div className={`absolute right-1 z-10 bg-chrome-black/80 px-1 py-px rounded text-[12px] font-medium text-chrome-white leading-tight tracking-wide ${isHistoryCard || isContinueCard ? 'bottom-2' : 'bottom-1'}`}>
            {formatDuration(video.durationSeconds)}
          </div>
        ) : null}

        {isHistoryCard || isContinueCard ? (
          <>
            <div className="absolute bottom-0 left-0 z-10 h-[3px] w-full bg-chrome-neutral-600">
              <div
                className="h-full bg-primary"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {isHistoryCard && onRemoveFromHistory ? (
              <button
                type="button"
                onClick={handleRemoveFromHistory}
                title="Remove from history"
                aria-label="Remove from history"
                className="absolute right-2 top-2 z-30 flex h-8 w-8 items-center justify-center rounded-full border border-chrome-white/15 bg-chrome-black/80 text-chrome-white opacity-0 transition-colors duration-200 ease-out hover:bg-chrome-red-950/50 hover:text-chrome-red-300 group-hover:opacity-100"
              >
                <Trash2 size={15} />
              </button>
            ) : null}
          </>
        ) : null}

        <div className="pointer-events-none absolute inset-0 bg-chrome-black/0 group-hover:bg-chrome-black/10 transition-colors duration-200" />
      </div>

      <div className="flex gap-3 pr-1 relative z-10">
        {!hideChannelAvatar && (
          <div 
            onClick={(e) => { void handleChannelNavigate(e); }}
            className="w-9 h-9 rounded-full bg-chrome-zinc-800 shrink-0 overflow-hidden flex items-center justify-center cursor-pointer mt-0.5 hover:opacity-80 transition-opacity"
          >
            {resolvedAvatarUrl ? (
              <img
                src={resolvedAvatarUrl}
                alt={video.channelName}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <span className="text-xs font-semibold text-chrome-zinc-400">{channelInitials}</span>
            )}
          </div>
        )}

        <div className="flex flex-col flex-1 min-w-0">
          <h3
            onClick={() => onPlay(video)}
            style={titleClampStyle}
            className="text-chrome-zinc-100 text-sm font-medium leading-snug cursor-pointer hover:text-[var(--color-primary)] transition-colors"
          >
            {displayTitle}
          </h3>
          <div
            onClick={(e) => { void handleChannelNavigate(e); }}
            className="text-chrome-zinc-400 text-[13px] mt-0.5 truncate cursor-pointer hover:text-chrome-zinc-300 transition-colors"
          >
            {video.channelName}
          </div>

          {/* View Count + Published */}
          <div className="text-chrome-zinc-500 text-[13px] flex items-center gap-0 mt-0">
            {video.viewCountText && <span>{video.viewCountText}</span>}
            {video.viewCountText && video.publishedText && <span className="mx-1">•</span>}
            {video.publishedText && <span>{video.publishedText}</span>}
          </div>
        </div>

        {/* Three-dot menu button */}
        <div className="relative shrink-0">
          <button
            onClick={openMenuFromDots}
            className="p-1 rounded-full text-chrome-zinc-500 hover:text-chrome-zinc-200 hover:bg-chrome-zinc-800 opacity-0 group-hover:opacity-100 transition duration-150 ease-out mt-0.5"
          >
            <MoreVertical size={18} />
          </button>
        </div>
      </div>

      {renderMenu()}
    </div>
  );
}

export const VideoCard = React.memo(VideoCardComponent);
