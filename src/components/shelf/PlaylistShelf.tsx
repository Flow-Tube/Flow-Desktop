import React from "react";
import { ShelfScroller } from "../ui/ShelfScroller";
import { PlaylistCard } from "../video/PlaylistCard";
import type { PlaylistSummary } from "../../types/video";
import { hoverMotion } from "../../lib/platform";

interface PlaylistShelfProps {
  title: string;
  /** Shown at the end of the header, such as a "See all" button. */
  action?: React.ReactNode;
  playlists: PlaylistSummary[];
  onPlaylistClick?: (playlist: PlaylistSummary) => void;
}

export const PlaylistShelf: React.FC<PlaylistShelfProps> = ({
  title,
  action,
  playlists,
  onPlaylistClick,
}) => {
  if (!playlists || playlists.length === 0) return null;

  return (
    <div className="relative flex flex-col gap-4 py-4 border-b border-chrome-zinc-900 last:border-0">
      {/* Shelf Header */}
      <div className="flex items-center justify-between">
        <h2 dir="auto" className="text-lg font-bold tracking-tight text-chrome-zinc-100">{title}</h2>
        {action}
      </div>

      <ShelfScroller className="flex gap-6 px-3 -mx-3 pt-3 -mt-1 pb-3">
        {playlists.map((playlist) => (
          <div
            key={playlist.id}
            className={`w-[240px] sm:w-[280px] shrink-0 ${hoverMotion("transform transition-transform duration-300 hover:translate-y-[-2px]")}`}
          >
            <PlaylistCard
              playlist={playlist}
              onClick={onPlaylistClick}
              thumbnailWidth={280}
            />
          </div>
        ))}
      </ShelfScroller>
    </div>
  );
};
