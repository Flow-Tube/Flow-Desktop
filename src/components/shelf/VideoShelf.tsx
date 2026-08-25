import React, { useRef, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScrollLimits = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setCanScrollLeft(scrollLeft > 2);
    // Give a tiny tolerance of 2px for rounding errors
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 2);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      checkScrollLimits();
      el.addEventListener("scroll", checkScrollLimits);
      window.addEventListener("resize", checkScrollLimits);
    }
    
    // Check again after a brief timeout to let images/content render
    const timer = setTimeout(checkScrollLimits, 200);
    
    return () => {
      if (el) {
        el.removeEventListener("scroll", checkScrollLimits);
        window.removeEventListener("resize", checkScrollLimits);
      }
      clearTimeout(timer);
    };
  }, [videos]);

  const handleScroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const { scrollLeft, clientWidth } = scrollRef.current;
      const scrollAmount = direction === "left" ? -clientWidth * 0.75 : clientWidth * 0.75;
      scrollRef.current.scrollTo({
        left: scrollLeft + scrollAmount,
        behavior: "smooth",
      });
    }
  };

  if (!videos || videos.length === 0) return null;

  return (
    <div className="relative group/shelf flex flex-col gap-4">
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

      {/* Shelf Slider Area */}
      <div className="relative w-full overflow-visible">
        {/* Left Navigation Chevron */}
        {canScrollLeft && (
          <button
            onClick={() => handleScroll("left")}
            className="absolute left-0 top-1/2 -translate-y-1/2 -ml-2 sm:-ml-4 z-20 flex items-center justify-center w-10 h-10 rounded-full bg-surface-container-high hover:bg-surface-container-highest border border-chrome-neutral-800 text-chrome-neutral-300 hover:text-chrome-neutral-100 opacity-0 group-hover/shelf:opacity-100 transition-colors duration-200 ease-out pointer-events-auto cursor-pointer"
            aria-label="Scroll left"
          >
            <ChevronLeft size={20} strokeWidth={2.5} />
          </button>
        )}

        {/* Scrollable Container */}
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto scroll-smooth scrollbar-none px-3 -mx-3 pt-3 -mt-2 pb-3 snap-x"
        >
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
        </div>

        {/* Right Navigation Chevron */}
        {canScrollRight && (
          <button
            onClick={() => handleScroll("right")}
            className="absolute right-0 top-1/2 -translate-y-1/2 -mr-2 sm:-mr-4 z-20 flex items-center justify-center w-10 h-10 rounded-full bg-surface-container-high hover:bg-surface-container-highest border border-chrome-neutral-800 text-chrome-neutral-300 hover:text-chrome-neutral-100 opacity-0 group-hover/shelf:opacity-100 transition-colors duration-200 ease-out pointer-events-auto cursor-pointer"
            aria-label="Scroll right"
          >
            <ChevronRight size={20} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
};
