import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ThumbsUp, ThumbsDown, Share2, Bookmark, Download, Check, WandSparkles } from "lucide-react";
import { Button } from "../ui/Button";
import { WatchOwner } from "./WatchOwner";
import { useSettingsStore } from "../../store/useSettingsStore";
import { usePlaylistModalStore } from "../../store/usePlaylistModalStore";
import { useDownloadStore } from "../../store/useDownloadStore";
import { useIsDownloaded } from "../../lib/useDownloads";
import { useVideoReactions } from "../../lib/useVideoReactions";
import { formatCount } from "../../lib/utils";
import { shareLink } from "../../lib/clipboard";
import { useUiStore } from "../../store/useUiStore";
import { getString } from "../../lib/i18n/index";
import { youtubeWatchUrl } from "../../lib/youtubeUrl";
import type { WatchMetadataProps } from "./types";

export function WatchMetadata({
  currentVideo,
  videoData,
  dearrowData,
  rydData,
}: WatchMetadataProps) {
  const navigate = useNavigate();
  const dearrowEnabled = useSettingsStore((s) => s.dearrowEnabled);
  const dearrowBadgeEnabled = useSettingsStore((s) => s.dearrowBadgeEnabled);
  const rytdEnabled = useSettingsStore((s) => s.rytdEnabled);
  const openAddToPlaylist = usePlaylistModalStore((s) => s.openAddToPlaylist);
  const openVideoDownload = useDownloadStore((s) => s.openVideo);
  const isDownloaded = useIsDownloaded(currentVideo.id);
  const reactions = useVideoReactions(currentVideo, videoData);
  const [showingOriginal, setShowingOriginal] = useState(false);

  const channelId = videoData?.channelId || currentVideo.channelId || "";
  const channelName = videoData?.channelName || currentVideo.channelName || getString("watch_unknown_channel");
  // Details arrive after playback has started, so the feed card's avatar stands in until then.
  const avatarUrl = videoData?.channelAvatarUrl || currentVideo.channelAvatarUrl || null;
  const hashtags = videoData?.hashtags ?? [];
  const badges = videoData?.badges ?? [];

  const dearrowTitle = dearrowEnabled ? dearrowData?.title ?? null : null;
  const primaryTitle = dearrowTitle ?? currentVideo.title;
  const canCrossfade = !!dearrowTitle && dearrowTitle !== currentVideo.title;
  const showBadge = !!dearrowTitle && dearrowBadgeEnabled;

  const shareVideo = async () => {
    const result = await shareLink(currentVideo.title, youtubeWatchUrl(currentVideo.id));
    if (result === "shared") return;
    useUiStore.getState().showToast({
      message: getString(result === "copied" ? "share_link_copied" : "share_link_copy_failed"),
      variant: result === "copied" ? "success" : "error",
    });
  };

  const likeLabel =
    rytdEnabled && rydData
      ? formatCount(rydData.likes)
      : videoData?.likeCountText
      ? formatCount(videoData.likeCountText)
      : getString("like");
  const dislikeLabel = rytdEnabled && rydData ? formatCount(rydData.dislikes) : getString("watch_dislike");
  const saveTarget = {
    ...currentVideo,
    title: primaryTitle,
    channelId,
    channelName,
    thumbnailUrl: dearrowData?.thumbnailUrl || currentVideo.thumbnailUrl || videoData?.thumbnailUrl,
    durationSeconds: currentVideo.durationSeconds ?? videoData?.durationSeconds ?? null,
  };

  return (
    <div className="flex flex-col gap-3">
      {hashtags.length > 0 && (
        <div className="-mb-2 flex flex-wrap gap-x-2 text-sm font-medium">
          {hashtags.map((tag) => (
            <button
              key={tag}
              onClick={() => navigate(`/search?q=${encodeURIComponent(tag)}`)}
              className="text-primary transition-opacity hover:opacity-80"
            >
              {tag}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-start gap-2">
        {canCrossfade ? (
          <h1
            onMouseEnter={() => setShowingOriginal(true)}
            onMouseLeave={() => setShowingOriginal(false)}
            className="grid cursor-default text-xl font-bold leading-snug tracking-tight text-chrome-neutral-100"
          >
            {/* Both titles are stacked; only the visible one may be selected, or a copy pastes both. */}
            <span
              className={`col-start-1 row-start-1 transition-opacity duration-200 ease-out ${
                showingOriginal ? "select-none opacity-0" : "select-text opacity-100"
              }`}
            >
              {primaryTitle}
            </span>
            <span
              aria-hidden
              className={`col-start-1 row-start-1 transition-opacity duration-200 ease-out ${
                showingOriginal ? "select-text opacity-100" : "select-none opacity-0"
              }`}
            >
              {currentVideo.title}
            </span>
          </h1>
        ) : primaryTitle ? (
          <h1 className="select-text text-xl font-bold leading-snug tracking-tight text-chrome-neutral-100">{primaryTitle}</h1>
        ) : (
          // A cold open starts playback from the video id alone; the title lands
          // a moment later. A placeholder bar reads better than an empty heading.
          <div className="h-7 w-3/5 animate-pulse rounded-md bg-chrome-neutral-800" aria-hidden />
        )}
        {showBadge && (
          <span title={getString("watch_dearrow_badge_hint")} className="mt-1 shrink-0 text-primary/70">
            <WandSparkles size={16} />
          </span>
        )}
      </div>

      {badges.length > 0 && (
        <div className="-mt-1 flex flex-wrap gap-1.5">
          {badges.map((badge) => (
            <span
              key={badge}
              className="rounded-full border border-chrome-neutral-800 px-2 py-0.5 text-xs font-medium text-chrome-neutral-400"
            >
              {badge}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <WatchOwner
          channelId={channelId}
          channelName={channelName}
          avatarUrl={avatarUrl}
          subscriberText={videoData?.subscriberCountText ?? null}
          badge={videoData?.channelBadge ?? null}
          collaborators={videoData?.collaborators ?? []}
        />

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-10 items-center divide-x divide-chrome-neutral-800 overflow-hidden rounded-full bg-surface-container-low">
            <button
              onClick={reactions.like}
              aria-pressed={reactions.state === "liked"}
              className={`flex h-full items-center gap-2 px-4 text-sm font-medium transition-colors hover:bg-surface-container ${
                reactions.state === "liked" ? "text-chrome-white" : "text-chrome-neutral-200"
              }`}
            >
              <ThumbsUp size={18} fill={reactions.state === "liked" ? "currentColor" : "none"} />
              <span>{likeLabel}</span>
            </button>
            <button
              onClick={reactions.dislike}
              aria-pressed={reactions.state === "disliked"}
              className={`flex h-full items-center gap-2 px-4 text-sm font-medium transition-colors hover:bg-surface-container ${
                reactions.state === "disliked" ? "text-chrome-white" : "text-chrome-neutral-200"
              }`}
            >
              <ThumbsDown size={18} fill={reactions.state === "disliked" ? "currentColor" : "none"} />
              <span>{dislikeLabel}</span>
            </button>
          </div>

          <Button variant="tonal" onClick={() => void shareVideo()}>
            <Share2 size={18} />
            {getString("share")}
          </Button>
          <Button variant="tonal" onClick={() => openAddToPlaylist(saveTarget)}>
            <Bookmark size={18} />
            {getString("save")}
          </Button>
          <Button variant="tonal" onClick={() => openVideoDownload(saveTarget)}>
            {isDownloaded ? <Check size={18} /> : <Download size={18} />}
            {getString(isDownloaded ? "downloaded" : "download")}
          </Button>
        </div>
      </div>
    </div>
  );
}
