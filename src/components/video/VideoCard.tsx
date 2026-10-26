import { useNavigate } from 'react-router-dom';
import { useSubscriptionStore } from '../../store/useSubscriptionStore';
import { useBlockedKeywordMatch, useFeedActionsStore } from '../../store/useFeedActionsStore';
import { useBlockedRevealStore } from '../../lib/blockedContent';
import { BlockedVideoCard } from './BlockedVideoCard';
import { useLiveStore } from '../../store/useLiveStore';
import { Plus, Ban, Check, MoreVertical, Trash2, GripHorizontal, Sparkles, Eye, EyeOff, Clock, ListPlus, ListVideo, Download, User, Share2 } from 'lucide-react';
import type { VideoSummary } from '../../types/video';
import { Button } from '../ui/Button';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useImageFallback } from '../../lib/useImageFallback';
import { useDeArrowOverride } from '../../lib/useDeArrowOverride';
import { getVideoDetails } from '../../lib/api/youtube';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useAppSettingsStore } from '../../store/useAppSettingsStore';
import { useChannelAvatar } from '../../lib/useChannelAvatar';
import { isUnavailableYoutubeThumbnail, resolveYoutubeThumbnailCandidates, upgradeAvatarUrl } from '../../lib/thumbnails';
import { IS_LINUX_RUNTIME } from '../../lib/platform';
import { useProxiedImageUrl } from '../../lib/useProxiedImageUrl';
import { SETTINGS } from '../../lib/settings/schema';
import type { MenuAnchor } from '../ui/AnchoredPortalMenu';
import { MediaMenu, type MediaMenuAction } from '../ui/MediaMenu';
import { shareLink } from '../../lib/clipboard';
import { youtubeWatchUrl } from '../../lib/youtubeUrl';
import { getString } from '../../lib/i18n/index';
import { useWatchLaterStore } from '../../store/useWatchLaterStore';
import { useUiStore } from '../../store/useUiStore';
import { showSaveFailedToast, showSaveToast } from '../../lib/saveToast';
import { usePlaylistModalStore } from '../../store/usePlaylistModalStore';
import { usePlayerStore } from '../../store/usePlayerStore';
import { useDownloadStore } from '../../store/useDownloadStore';
import { useDownloadsLibraryStore } from '../../store/useDownloadsLibraryStore';
import { findDownloadedRecord, useIsDownloaded } from '../../lib/useDownloads';
import { extractDominantColorFromImage, type Rgb } from '../../lib/useDominantColor';
import { formatPublishedText, formatYouTubeRelativeTime } from '../../lib/publishedDate';
import { ColorWash, COLOR_WASH_HOST } from '../ui/ColorWash';
import { CardPills, ChannelLabel, CollabAvatars, UpcomingBadge } from "./CardMeta";
import { collaboratorsByline } from "../../lib/collaborators";

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
  /** List rows in a playlist sorted by date added say when each video was added. */
  showAddedDate?: boolean;
  /** Why a feed shows this card, at the top of its menu. */
  reason?: string;
  /** Whether the card is drawn wider than `hqdefault`; left out, the screen's pixel ratio decides. */
  highResThumbnail?: boolean;
}

/*
  CORS mode exists solely so the hover wash can read the thumbnail's pixels back
  off a canvas. That readback is disabled on Linux (WebKitGTK composites on the
  CPU), where the only thing the attribute still buys is a stricter fetch that
  cannot reuse a plain cached image.
*/
const THUMBNAIL_CROSS_ORIGIN = IS_LINUX_RUNTIME ? undefined : 'anonymous';

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
  showAddedDate = false,
  reason,
  highResThumbnail,
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
  const cardRef = useRef<HTMLDivElement>(null);
  const thumbnailRef = useRef<HTMLImageElement>(null);

  const isChannel = video.id.startsWith("channel:");
  const cleanId = isChannel ? video.id.replace("channel:", "") : video.id;
  const channelId = video.channelId || "";

  const markLive = useLiveStore((s) => s.markLive);
  const liveFromStore = useLiveStore((s) => s.liveIds.has(video.id));
  const isLiveVideo = !!video.isLive || liveFromStore;
  const publishedText = formatPublishedText(video);
  // A Short known from its card opens in the Shorts player, whatever the list.
  const play = useCallback(() => {
    if (video.isShort && !isChannel) navigate(`/shorts/${video.id}`);
    else onPlay(video);
  }, [video, isChannel, navigate, onPlay]);

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
  // A collaboration names every channel; it opens the first, which is the uploader.
  const collaborators = video.collaborators ?? [];
  const isCollab = collaborators.length >= 2;
  const byline = isCollab ? collaboratorsByline(collaborators) : video.channelName;
  const channelCardAvatarUrl = useProxiedImageUrl(upgradeAvatarUrl(video.thumbnailUrl));
  // Cached and de-duplicated across cards and remounts by the hook; this used to
  // be a bare `getDeArrowOverride` in an effect, one IPC per card, every mount.
  const dearrowOverride = useDeArrowOverride(isChannel ? null : video.id, dearrowEnabled);
  const overriddenTitle = dearrowOverride?.title || null;
  const overriddenThumbnail = dearrowOverride?.thumbnailUrl || null;

  const displayTitle = overriddenTitle || video.title;
  const thumbnailCandidates = useMemo(
    () => resolveYoutubeThumbnailCandidates(video.id, overriddenThumbnail || video.thumbnailUrl, highResThumbnail),
    [highResThumbnail, overriddenThumbnail, video.id, video.thumbnailUrl],
  );
  const { src: displayThumbnail, onError: handleThumbnailError } = useImageFallback(thumbnailCandidates);

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
      displayThumbnail !== thumbnailCandidates[thumbnailCandidates.length - 1]
    ) {
      handleThumbnailError();
      return;
    }

    if (!IS_LINUX_RUNTIME && isHovered && !dominantColor) {
      const color = extractDominantColorFromImage(img);
      if (color) {
        setDominantColor(color);
      }
    }
  }, [displayThumbnail, dominantColor, handleThumbnailError, isHovered, thumbnailCandidates]);

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
    setDominantColor(null);
  }, [overriddenThumbnail, video.id, video.thumbnailUrl]);

  const handleSubscribeToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const idToToggle = isChannel ? cleanId : channelId;
    if (!idToToggle) return;
    if (subStatus) {
      unsubscribe(idToToggle, { learn: true });
    } else {
      subscribe(idToToggle, isChannel ? video.title : video.channelName, video.thumbnailUrl || undefined, { learn: true });
    }
  };

  const handleRemoveFromHistory = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemoveFromHistory?.(video.id);
  };

  const handleChannelNavigate = useCallback(async (e?: React.MouseEvent<HTMLElement>) => {
    e?.stopPropagation();
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



  const toastItem = { title: displayTitle, image: displayThumbnail, shape: "landscape" as const };

  const handleToggleWatchLater = async () => {
    const removing = isSavedToWatchLater;
    try {
      if (removing) {
        await removeFromWatchLater(video.id);
        showSaveToast({
          destination: { kind: "watchLater" },
          item: toastItem,
          removed: true,
          undo: () => saveToWatchLater(video),
        });
        return;
      }

      await saveToWatchLater(video);
      showSaveToast({
        destination: { kind: "watchLater" },
        item: toastItem,
        undo: () => removeFromWatchLater(video.id),
      });
    } catch (error) {
      console.error("Failed to update Watch Later", error);
      showSaveFailedToast({
        destination: { kind: "watchLater" },
        item: toastItem,
        removed: removing,
        retry: handleToggleWatchLater,
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

    if (isDuplicate) {
      showToast({ variant: "info", message: getString("queue_duplicate_toast") });
      return;
    }
    showSaveToast({
      destination: { kind: "queue" },
      item: toastItem,
      undo: () => {
        const { queue, removeFromQueue } = usePlayerStore.getState();
        const index = queue.map((item) => item.id).lastIndexOf(video.id);
        if (index >= 0) removeFromQueue(index);
      },
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
      image: video.thumbnailUrl,
    });
  };

  // ── Menu dropdown ───
  const handleShare = async () => {
    const result = await shareLink(displayTitle, youtubeWatchUrl(video.id));
    if (result === "copied") showToast({ variant: "success", message: getString("share_link_copied") });
    if (result === "failed") showToast({ variant: "error", message: getString("share_link_copy_failed") });
  };

  const feedActionFailed = () => showToast({ variant: "error", message: getString("feed_action_failed") });

  const menuActions: MediaMenuAction[] = [
    {
      id: "queue",
      label: getString("music_add_to_queue"),
      tileLabel: getString("menu_tile_queue"),
      icon: <ListPlus size={18} />,
      group: "quick",
      onSelect: handleAddToQueue,
    },
    {
      id: "watch-later",
      label: getString(isSavedToWatchLater ? "video_remove_from_watch_later" : "video_save_to_watch_later"),
      tileLabel: getString(isSavedToWatchLater ? "menu_tile_saved" : "menu_tile_save"),
      icon: <Clock size={18} />,
      group: "quick",
      active: isSavedToWatchLater,
      onSelect: handleToggleWatchLater,
    },
    {
      id: "playlist",
      label: getString("video_add_to_playlist"),
      tileLabel: getString("menu_tile_playlist"),
      icon: <ListVideo size={18} />,
      group: "quick",
      onSelect: () => openAddToPlaylist(video),
    },
    isDownloaded
      ? {
        id: "share",
        label: getString("share"),
        tileLabel: getString("menu_tile_share"),
        icon: <Share2 size={18} />,
        group: "quick",
        onSelect: handleShare,
      }
      : {
        id: "download",
        label: getString("download"),
        tileLabel: getString("menu_tile_download"),
        icon: <Download size={18} />,
        group: "quick",
        onSelect: handleDownloadAction,
      },
    ...(isDownloaded
      ? [{
        id: "remove-download",
        label: getString("video_remove_download"),
        icon: <Trash2 size={16} />,
        group: "library" as const,
        danger: true,
        onSelect: handleDownloadAction,
      }]
      : [{
        id: "share",
        label: getString("share"),
        icon: <Share2 size={16} />,
        group: "library" as const,
        onSelect: handleShare,
      }]),
    ...(onRemoveFromContinueWatching
      ? [{
        id: "remove-continue",
        label: getString("video_remove_from_continue_watching"),
        icon: <Trash2 size={16} />,
        group: "library" as const,
        danger: true,
        onSelect: () => onRemoveFromContinueWatching(video.id),
      }]
      : []),
    {
      id: "channel",
      label: getString("video_view_channel"),
      icon: <User size={16} />,
      group: "go",
      onSelect: () => handleChannelNavigate(),
    },
    {
      id: "more-like-this",
      label: getString("menu_more_like_this"),
      icon: <Sparkles size={16} />,
      group: "feed",
      onSelect: () => moreLikeThis(video),
    },
    {
      id: "mark-watched",
      label: getString("menu_mark_watched"),
      icon: <Eye size={16} />,
      group: "feed",
      onSelect: () => markWatched(video),
    },
    {
      id: "not-interested",
      label: getString("menu_not_interested"),
      icon: <Ban size={16} />,
      group: "feed",
      onSelect: () => notInterested(video).catch(feedActionFailed),
    },
    ...(video.channelId
      ? [{
        id: "block-channel",
        label: getString("menu_dont_show_channel"),
        icon: <EyeOff size={16} />,
        group: "feed" as const,
        onSelect: () => blockChannelAction(video).catch(feedActionFailed),
      }]
      : []),
  ];

  const renderMenu = () => {
    if (!showMenu || !menuAnchor) return null;

    return (
      <MediaMenu
        anchor={menuAnchor}
        onClose={() => setShowMenu(false)}
        header={{ title: displayTitle, subtitle: byline, image: displayThumbnail, imageShape: "landscape" }}
        actions={menuActions}
        note={reason ? { title: getString("home_feed_why"), body: reason } : null}
      />
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
          onClick={play}
        >
          {displayThumbnail ? (
            <img
              ref={thumbnailRef}
              src={displayThumbnail}
              alt={displayTitle}
              className="h-full w-full object-cover"
              crossOrigin={THUMBNAIL_CROSS_ORIGIN}
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
          ) : video.isUpcoming ? (
            <UpcomingBadge className="absolute bottom-1 right-1" />
          ) : video.durationSeconds ? (
            <div className="absolute bottom-1 right-1 z-10 rounded bg-chrome-black/80 px-1 py-px text-[11px] font-medium leading-tight text-chrome-white">
              {formatDuration(video.durationSeconds)}
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <h3
            onClick={play}
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
            <ChannelLabel name={byline} verified={video.isVerified} />
          </button>
          <div className="text-[13px] text-chrome-neutral-500">
            {video.viewCountText && <span>{video.viewCountText}</span>}
            {video.viewCountText && publishedText && <span className="mx-1">•</span>}
            {publishedText && <span>{publishedText}</span>}
          </div>
          <CardPills video={video} />
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
          onClick={play}
        >
          {displayThumbnail ? (
            <img
              ref={thumbnailRef}
              src={displayThumbnail}
              alt={displayTitle}
              className="h-full w-full object-cover"
              crossOrigin={THUMBNAIL_CROSS_ORIGIN}
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
          ) : video.isUpcoming ? (
            <UpcomingBadge className="absolute bottom-1 right-1" />
          ) : video.durationSeconds ? (
            <div className="absolute bottom-1 right-1 z-10 rounded bg-chrome-black/80 px-1 py-px text-[12px] font-medium leading-tight tracking-wide text-chrome-white">
              {formatDuration(video.durationSeconds)}
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <h3
            onClick={play}
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
            <ChannelLabel name={byline} verified={video.isVerified} />
          </button>
          <div className="mt-0.5 text-[13px] text-chrome-neutral-500">
            {showAddedDate && video.addedAtInPlaylist ? (
              <span>
                {getString("playlist_video_added_template", formatYouTubeRelativeTime(video.addedAtInPlaylist))}
              </span>
            ) : (
              <>
                {video.viewCountText && <span>{video.viewCountText}</span>}
                {video.viewCountText && publishedText && <span className="mx-1">•</span>}
                {publishedText && <span>{publishedText}</span>}
              </>
            )}
          </div>
          <CardPills video={video} />
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
        onClick={play}
      >
        {displayThumbnail ? (
          <img
            ref={thumbnailRef}
            src={displayThumbnail}
            alt={displayTitle}
            className={`w-full h-full object-cover${IS_LINUX_RUNTIME ? "" : " transition-transform duration-300 group-hover:scale-[1.03]"}`}
            crossOrigin={THUMBNAIL_CROSS_ORIGIN}
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
        ) : video.isUpcoming ? (
          <UpcomingBadge className="absolute bottom-1 right-1" />
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
            className={`w-9 h-9 shrink-0 flex items-center justify-center cursor-pointer mt-0.5 hover:opacity-80 transition-opacity ${
              isCollab ? "" : "rounded-full bg-chrome-zinc-800 overflow-hidden"
            }`}
          >
            {isCollab ? (
              <CollabAvatars collaborators={collaborators} />
            ) : resolvedAvatarUrl ? (
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
            onClick={play}
            style={titleClampStyle}
            className="text-chrome-zinc-100 text-sm font-medium leading-snug cursor-pointer hover:text-[var(--color-primary)] transition-colors"
          >
            {displayTitle}
          </h3>
          <div
            onClick={(e) => { void handleChannelNavigate(e); }}
            className="text-chrome-zinc-400 text-[13px] mt-0.5 truncate cursor-pointer hover:text-chrome-zinc-300 transition-colors"
          >
            <ChannelLabel name={byline} verified={video.isVerified} />
          </div>

          {/* View Count + Published */}
          <div className="text-chrome-zinc-500 text-[13px] flex items-center gap-0 mt-0">
            {video.viewCountText && <span>{video.viewCountText}</span>}
            {video.viewCountText && publishedText && <span className="mx-1">•</span>}
            {publishedText && <span>{publishedText}</span>}
          </div>
          <CardPills video={video} />
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

function VideoCardGate(props: VideoCardProps) {
  const matchBlockedKeyword = useBlockedKeywordMatch();
  const revealedVideoIds = useBlockedRevealStore((s) => s.revealedVideoIds);
  const keyword = matchBlockedKeyword(props.video);

  if (!keyword || revealedVideoIds.has(props.video.id)) {
    return <VideoCardComponent {...props} />;
  }

  return (
    <BlockedVideoCard
      video={props.video}
      keyword={keyword}
      listLayout={props.variant === 'list' || props.variant === 'compact'}
    />
  );
}

export const VideoCard = React.memo(VideoCardGate);
