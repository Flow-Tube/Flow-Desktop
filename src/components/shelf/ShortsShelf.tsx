import React, { useRef, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ShortVideoSummary, VideoSummary } from "../../types/video";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { SETTINGS } from "../../lib/settings/schema";
import { ShortCard } from "../shorts/ShortCard";

interface ShortsShelfProps {
  title: string;
  shorts: ShortVideoSummary[];
  onPlay: (video: VideoSummary) => void;
}

export const ShortsShelf: React.FC<ShortsShelfProps> = ({
  title,
  shorts,
}) => {
  const shortsShelfEnabled = useAppSettingsStore((state) => state.values[SETTINGS.SHORTS_SHELF_ENABLED] !== "false");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScrollLimits = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setCanScrollLeft(scrollLeft > 2);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 2);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      checkScrollLimits();
      el.addEventListener("scroll", checkScrollLimits);
      window.addEventListener("resize", checkScrollLimits);
    }
    
    const timer = setTimeout(checkScrollLimits, 200);
    
    return () => {
      if (el) {
        el.removeEventListener("scroll", checkScrollLimits);
        window.removeEventListener("resize", checkScrollLimits);
      }
      clearTimeout(timer);
    };
  }, [shorts]);

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

  if (!shortsShelfEnabled || !shorts || shorts.length === 0) return null;

  return (
    <div className="relative group/shelf flex flex-col gap-4 py-4 border-b border-chrome-zinc-900 last:border-0">
      {/* Shelf Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-chrome-zinc-100 tracking-tight flex items-center gap-2">
          <span>{title}</span>
          <span className="text-xs text-chrome-zinc-500 font-semibold bg-chrome-zinc-900 border border-chrome-zinc-800/80 px-2 py-0.5 rounded-full">
            {shorts.length}
          </span>
        </h2>
      </div>

      {/* Shelf Slider Area */}
      <div className="relative w-full overflow-visible">
        {/* Left Navigation Chevron */}
        {canScrollLeft && (
          <button
            onClick={() => handleScroll("left")}
            className="absolute left-0 top-1/2 -translate-y-1/2 -ml-2 sm:-ml-4 z-20 flex items-center justify-center w-10 h-10 rounded-full bg-chrome-black/80 hover:bg-chrome-black border border-chrome-zinc-800 text-chrome-zinc-200 hover:text-chrome-white opacity-0 group-hover/shelf:opacity-100 transition duration-200 ease-out transform active:scale-90 hover:scale-105 pointer-events-auto cursor-pointer"
            aria-label="Scroll left"
          >
            <ChevronLeft size={20} strokeWidth={2.5} />
          </button>
        )}

        {/* Scrollable Container */}
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto scroll-smooth scrollbar-none px-3 -mx-3 pt-3 -mt-2 pb-3"
        >
          {shorts.map((short) => (
            <ShortCard
              key={short.id}
              short={short}
              queue={shorts}
              variant="shelf"
            />
          ))}
        </div>

        {/* Right Navigation Chevron */}
        {canScrollRight && (
          <button
            onClick={() => handleScroll("right")}
            className="absolute right-0 top-1/2 -translate-y-1/2 -mr-2 sm:-mr-4 z-20 flex items-center justify-center w-10 h-10 rounded-full bg-chrome-black/80 hover:bg-chrome-black border border-chrome-zinc-800 text-chrome-zinc-200 hover:text-chrome-white opacity-0 group-hover/shelf:opacity-100 transition duration-200 ease-out transform active:scale-90 hover:scale-105 pointer-events-auto cursor-pointer"
            aria-label="Scroll right"
          >
            <ChevronRight size={20} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
};
