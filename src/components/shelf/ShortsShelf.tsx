import React from "react";
import { ShelfScroller } from "../ui/ShelfScroller";
import type { ShortVideoSummary, VideoSummary } from "../../types/video";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { SETTINGS } from "../../lib/settings/schema";
import { useShortsEnabled } from "../../lib/useShortsContent";
import { ShortCard } from "../shorts/ShortCard";

interface ShortsShelfProps {
  title: string;
  /** Shown at the end of the header, such as a "See all" button. */
  action?: React.ReactNode;
  shorts: ShortVideoSummary[];
  onPlay: (video: VideoSummary) => void;
}

export const ShortsShelf: React.FC<ShortsShelfProps> = ({
  title,
  action,
  shorts,
}) => {
  const shortsShelfEnabled = useAppSettingsStore((state) => state.values[SETTINGS.SHORTS_SHELF_ENABLED] !== "false");
  const shortsEnabled = useShortsEnabled();
  if (!shortsShelfEnabled || !shortsEnabled || !shorts?.length) return null;

  return (
    <div className="relative flex flex-col gap-4 py-4 border-b border-chrome-zinc-900 last:border-0">
      {/* Shelf Header */}
      <div className="flex items-center justify-between">
        <h2 dir="auto" className="text-lg font-bold tracking-tight text-chrome-zinc-100">{title}</h2>
        {action}
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
