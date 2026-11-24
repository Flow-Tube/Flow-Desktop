import React, { useMemo } from "react";
import { ShelfScroller } from "../ui/ShelfScroller";
import { VideoCard } from "../video/VideoCard";
import type { VideoSummary } from "../../types/video";
import { hoverMotion } from "../../lib/platform";
import { uniqueVideoKeys } from "../../lib/videoKeys";

// The `sm:w-[320px]` below, the widest a shelf card is drawn.
const SHELF_CARD_WIDTH = 320;

interface VideoShelfProps {
  title?: string;
  /** Shown at the end of the header, such as a "See all" button. */
  action?: React.ReactNode;
  videos: VideoSummary[];
  onPlay: (video: VideoSummary) => void;
  onAddToQueue?: (video: VideoSummary) => void;
  onRemoveFromHistory?: (videoId: string) => void;
  onRemoveFromContinueWatching?: (videoId: string) => void;
  getVideoKey?: (video: VideoSummary, index: number) => string;
  variant?: "default" | "history" | "continue";
  hideChannelAvatar?: boolean;
}

export const VideoShelf: React.FC<VideoShelfProps> = ({
  title,
  action,
  videos,
  onPlay,
  onAddToQueue,
  onRemoveFromHistory,
  onRemoveFromContinueWatching,
  getVideoKey,
  variant = "default",
  hideChannelAvatar = true,
}) => {
  const defaultKeys = useMemo(() => uniqueVideoKeys(videos ?? []), [videos]);
  if (!videos || videos.length === 0) return null;

  return (
    <div className="relative flex flex-col gap-4">
      {/* Shelf Header */}
      {title ? (
        <div className="flex items-center justify-between">
          <h2 dir="auto" className="text-lg font-bold tracking-tight text-chrome-zinc-100">{title}</h2>
          {action}
        </div>
      ) : null}

      <ShelfScroller className="flex gap-4 px-3 scroll-px-3 -mx-3 pt-3 -mt-2 pb-3 snap-x">
        {videos.map((video, index) => (
          <div
            key={getVideoKey ? getVideoKey(video, index) : defaultKeys[index]}
            className={`w-[280px] sm:w-[320px] shrink-0 ${hoverMotion("transform transition-transform duration-300 hover:translate-y-[-2px]")}`}
          >
            <VideoCard
              video={video}
              onPlay={onPlay}
              onAddToQueue={onAddToQueue}
              onRemoveFromHistory={onRemoveFromHistory}
              onRemoveFromContinueWatching={onRemoveFromContinueWatching}
              variant={variant}
              hideChannelAvatar={hideChannelAvatar}
              thumbnailWidth={SHELF_CARD_WIDTH}
            />
          </div>
        ))}
      </ShelfScroller>
    </div>
  );
};
