import React from "react";
import { ShelfScroller } from "../ui/ShelfScroller";
import { VideoCard } from "../video/VideoCard";
import type { VideoSummary } from "../../types/video";

interface VideoShelfProps {
  title?: string;
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
  videos,
  onPlay,
  onAddToQueue,
  onRemoveFromHistory,
  onRemoveFromContinueWatching,
  getVideoKey,
  variant = "default",
  hideChannelAvatar = true,
}) => {
  if (!videos || videos.length === 0) return null;

  return (
    <div className="relative flex flex-col gap-4">
      {/* Shelf Header */}
      {title ? (
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-chrome-zinc-100 tracking-tight flex items-center gap-2">
            <span>{title}</span>
            <span className="text-xs text-chrome-zinc-500 font-semibold bg-surface-container-low border border-chrome-neutral-800 px-2 py-0.5 rounded-full">
              {videos.length}
            </span>
          </h2>
        </div>
      ) : null}

      <ShelfScroller className="flex gap-4 px-3 -mx-3 pt-3 -mt-2 pb-3 snap-x">
        {videos.map((video, index) => (
          <div
            key={getVideoKey ? getVideoKey(video, index) : `${video.id}-${index}`}
            className="w-[280px] sm:w-[320px] shrink-0 transform transition-transform duration-300 hover:translate-y-[-2px]"
          >
            <VideoCard
              video={video}
              onPlay={onPlay}
              onAddToQueue={onAddToQueue}
              onRemoveFromHistory={onRemoveFromHistory}
              onRemoveFromContinueWatching={onRemoveFromContinueWatching}
              variant={variant}
              hideChannelAvatar={hideChannelAvatar}
            />
          </div>
        ))}
      </ShelfScroller>
    </div>
  );
};
