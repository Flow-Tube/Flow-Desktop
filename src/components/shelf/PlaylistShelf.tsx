import React from "react";
import { ShelfScroller } from "../ui/ShelfScroller";
import { PlaylistCard } from "../video/PlaylistCard";
import type { PlaylistSummary } from "../../types/video";

interface PlaylistShelfProps {
  title: string;
  playlists: PlaylistSummary[];
  onPlaylistClick?: (playlist: PlaylistSummary) => void;
}

export const PlaylistShelf: React.FC<PlaylistShelfProps> = ({
  title,
  playlists,
  onPlaylistClick,
}) => {
  if (!playlists || playlists.length === 0) return null;

  return (
    <div className="relative flex flex-col gap-4 py-4 border-b border-chrome-zinc-900 last:border-0">
      {/* Shelf Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-chrome-zinc-100 tracking-tight flex items-center gap-2">
          <span>{title}</span>
          <span className="text-xs text-chrome-zinc-500 font-semibold bg-chrome-zinc-900 border border-chrome-zinc-800/80 px-2 py-0.5 rounded-full">
            {playlists.length}
          </span>
        </h2>
      </div>

      <ShelfScroller className="flex gap-6 px-3 -mx-3 pt-3 -mt-1 pb-3">
        {playlists.map((playlist) => (
          <div
            key={playlist.id}
            className="w-[240px] sm:w-[280px] shrink-0 transform transition-transform duration-300 hover:translate-y-[-2px]"
          >
            <PlaylistCard
              playlist={playlist}
              onClick={onPlaylistClick}
            />
          </div>
        ))}
      </ShelfScroller>
    </div>
  );
};
