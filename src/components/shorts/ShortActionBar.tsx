import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Ban,
  Bookmark,
  BookmarkCheck,
  Copy,
  Download,
  EyeOff,
  MessageCircle,
  MoreVertical,
  Share2,
  ThumbsDown,
  ThumbsUp,
  type LucideIcon,
} from "lucide-react";
import { useVideoReactions } from "../../lib/useVideoReactions";
import { useUiStore } from "../../store/useUiStore";
import { useFeedActionsStore } from "../../store/useFeedActionsStore";
import {
  isShortSaved,
  removeShortFromLibrary,
  saveShortToLibrary,
} from "../../lib/savedShortsLibrary";
import { getString } from "../../lib/i18n/index";
import { formatCount } from "../../lib/utils";
import type { ShortItem, ShortsPanelState } from "../../types/shorts";
import type { ShortVideoSummary, VideoDetails, VideoSummary } from "../../types/video";
import type { RydData } from "../../lib/api/foss";

interface ShortActionBarProps {
  short: ShortItem;
  details?: VideoDetails | null;
  rydData?: RydData | null;
  commentCountText?: string | null;
  onRequestPanel: (panel: ShortsPanelState) => void;
  onRequestAdvance?: () => void;
}

export function ShortActionBar({
  short,
  details,
  rydData,
  commentCountText,
  onRequestPanel,
  onRequestAdvance,
}: ShortActionBarProps) {
  const showToast = useUiStore((s) => s.showToast);
  const notInterestedAction = useFeedActionsStore((s) => s.notInterested);
  const blockChannelAction = useFeedActionsStore((s) => s.blockChannel);
  const [menuOpen, setMenuOpen] = useState(false);
  const [savedToLibrary, setSavedToLibrary] = useState(false);
  const likeCountText = rydData
    ? formatCount(rydData.likes)
    : formatCount(short.likeCountText ?? details?.likeCountText) || "Like";
  const dislikeCountText = rydData ? formatCount(rydData.dislikes) : "Dislike";
  const resolvedCommentCountText = formatCount(commentCountText ?? short.commentCountText) || "Comments";
  const resolvedTitle = details?.title?.trim() || short.title || "Short";
  const resolvedChannelName = details?.channelName?.trim() || short.channelName;
  const resolvedChannelId = details?.channelId ?? short.channelId ?? null;
  const resolvedThumbnailUrl = details?.thumbnailUrl ?? short.thumbnailUrl;

  const video = useMemo<VideoSummary>(
    () => ({
      id: short.id,
      title: resolvedTitle,
      channelName: resolvedChannelName,
      channelId: resolvedChannelId,
      thumbnailUrl: resolvedThumbnailUrl,
      durationSeconds: details?.durationSeconds ?? 60,
      publishedText: details?.publishedText ?? short.publishedText ?? null,
      viewCountText: details?.viewCountText ?? short.viewCountText ?? null,
      channelAvatarUrl: short.channelAvatarUrl ?? null,
      isLive: false,
    }),
    [
      details?.durationSeconds,
      details?.publishedText,
      details?.viewCountText,
      resolvedChannelId,
      resolvedChannelName,
      resolvedThumbnailUrl,
      resolvedTitle,
      short,
    ],
  );
  const savedShort = useMemo<ShortVideoSummary>(
    () => ({
      type: "short",
      id: short.id,
      title: resolvedTitle,
      channelName: resolvedChannelName || null,
      channelId: resolvedChannelId,
      thumbnailUrl: resolvedThumbnailUrl,
      channelAvatarUrl: short.channelAvatarUrl ?? null,
      viewCountText: details?.viewCountText ?? short.viewCountText ?? null,
      publishedText: details?.publishedText ?? short.publishedText ?? null,
    }),
    [
      details?.publishedText,
      details?.viewCountText,
      resolvedChannelId,
      resolvedChannelName,
      resolvedThumbnailUrl,
      resolvedTitle,
      short,
    ],
  );
  const { state, like, dislike } = useVideoReactions(video, { channelId: short.channelId ?? null });

  useEffect(() => {
    let active = true;
    isShortSaved(short.id)
      .then((saved) => {
        if (active) setSavedToLibrary(saved);
      })
      .catch((error) => console.warn("Failed to read saved Short state", error));

    return () => {
      active = false;
    };
  }, [short.id]);

  const copyLink = () => {
    setMenuOpen(false);
    void navigator.clipboard?.writeText(`https://www.youtube.com/shorts/${short.id}`);
    showToast({ variant: "success", message: getString("shorts_link_copied") });
  };

  const notInterested = () => {
    setMenuOpen(false);
    void notInterestedAction(video);
    showToast({ variant: "success", message: getString("shorts_not_interested") });
    onRequestAdvance?.();
  };

  const dontRecommendChannel = () => {
    setMenuOpen(false);
    if (!short.channelId) return;
    void blockChannelAction(video);
    showToast({ variant: "success", message: getString("shorts_channel_not_recommended") });
    onRequestAdvance?.();
  };

  const toggleSavedShort = async () => {
    setMenuOpen(false);
    try {
      if (savedToLibrary) {
        await removeShortFromLibrary(short.id);
        setSavedToLibrary(false);
        showToast({ variant: "success", message: getString("shorts_removed_from_library") });
        return;
      }

      await saveShortToLibrary(savedShort);
      setSavedToLibrary(true);
      showToast({ variant: "success", message: getString("shorts_saved_to_library") });
    } catch (error) {
      console.error("Failed to update saved Shorts", error);
      showToast({ variant: "error", message: getString("shorts_save_failed") });
    }
  };

  const downloadShort = () => {
    setMenuOpen(false);
    showToast({ variant: "info", message: getString("shorts_download_coming_soon") });
  };

  return (
    <motion.div layout className="mb-4 flex w-[260px] flex-col items-start gap-5 lg:w-[280px]">
      <ActionButton
        ariaLabel="Like"
        active={state === "liked"}
        countText={likeCountText}
        onClick={like}
        icon={<ThumbsUp className="h-6 w-6" fill={state === "liked" ? "currentColor" : "none"} />}
      />
      <ActionButton
        ariaLabel="Dislike"
        active={state === "disliked"}
        countText={dislikeCountText}
        onClick={dislike}
        icon={<ThumbsDown className="h-6 w-6" fill={state === "disliked" ? "currentColor" : "none"} />}
      />
      <ActionButton
        ariaLabel="Comments"
        countText={resolvedCommentCountText}
        onClick={() => onRequestPanel("comments")}
        icon={<MessageCircle className="h-6 w-6" />}
      />
      <ActionButton
        ariaLabel="Share"
        countText="Share"
        onClick={copyLink}
        icon={<Share2 className="h-6 w-6" />}
      />

      <div className="relative">
        <ActionButton
          ariaLabel="More options"
          active={menuOpen}
          countText="More"
          onClick={() => setMenuOpen((open) => !open)}
          icon={<MoreVertical className="h-6 w-6" />}
        />
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute bottom-2 right-16 z-20 w-64 overflow-hidden rounded-xl border border-chrome-neutral-800 bg-surface-container-high py-1">
              <MenuItem icon={savedToLibrary ? BookmarkCheck : Bookmark} onClick={() => void toggleSavedShort()}>
                {getString(savedToLibrary ? "shorts_menu_remove_from_library" : "shorts_menu_save_to_library")}
              </MenuItem>
              <MenuItem icon={Download} onClick={downloadShort}>{getString("shorts_menu_download")}</MenuItem>
              <MenuItem icon={Ban} onClick={notInterested}>{getString("shorts_menu_not_interested")}</MenuItem>
              {short.channelId && (
                <MenuItem icon={EyeOff} onClick={dontRecommendChannel}>
                  {getString("shorts_menu_dont_recommend_channel")}
                </MenuItem>
              )}
              <MenuItem icon={Copy} onClick={copyLink}>{getString("shorts_menu_copy_link")}</MenuItem>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

function ActionButton({
  icon,
  countText,
  active,
  ariaLabel,
  onClick,
}: {
  icon: ReactNode;
  countText?: string;
  active?: boolean;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={onClick}
        className={`flex h-14 w-14 items-center justify-center rounded-full border border-chrome-white/10 bg-chrome-black/60 text-chrome-white transition-colors duration-200 ease-out hover:bg-chrome-black/80 ${
          active ? "text-primary" : ""
        }`}
      >
        {icon}
      </button>
      <span className="mt-1 mb-2 h-4 text-xs font-semibold text-chrome-neutral-300">
        {countText ?? ""}
      </span>
    </div>
  );
}

function MenuItem({
  icon: Icon,
  onClick,
  children,
}: {
  icon: LucideIcon;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-chrome-neutral-200 transition-colors hover:bg-surface-container-highest"
    >
      <Icon className="h-4 w-4 shrink-0 text-chrome-neutral-400" />
      {children}
    </button>
  );
}
