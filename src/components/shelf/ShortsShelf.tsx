import React from "react";
import { ShelfScroller } from "../ui/ShelfScroller";
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
  if (!shortsShelfEnabled || !shorts || shorts.length === 0) return null;

  return (
    <div className="relative flex flex-col gap-4 py-4 border-b border-chrome-zinc-900 last:border-0">
      {/* Shelf Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-chrome-zinc-100 tracking-tight flex items-center gap-2">
          <span>{title}</span>
          <span className="text-xs text-chrome-zinc-500 font-semibold bg-chrome-zinc-900 border border-chrome-zinc-800/80 px-2 py-0.5 rounded-full">
            {shorts.length}
          </span>
        </h2>
      </div>

      <ShelfScroller className="flex gap-4 px-3 -mx-3 pt-3 -mt-2 pb-3">
        {shorts.map((short) => (
          <ShortCard
            key={short.id}
            short={short}
            queue={shorts}
            variant="shelf"
          />
        ))}
      </ShelfScroller>
    </div>
  );
};
