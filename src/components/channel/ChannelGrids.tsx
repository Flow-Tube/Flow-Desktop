import React from "react";
import { PlaylistCard } from "../video/PlaylistCard";
import { PostCard } from "../video/PostCard";
import { ShortCard } from "../shorts/ShortCard";
import type { 
  ShortVideoSummary, 
  PlaylistSummary, 
  PostSummary 
} from "../../types/video";
import { useGridStyle } from "../../lib/useGridColumns";

// --- Shorts Grid ---

interface ChannelShortsGridProps {
  shorts: ShortVideoSummary[];
}

export const ChannelShortsGrid: React.FC<ChannelShortsGridProps> = ({ shorts }) => {
  const gridStyle = useGridStyle({ density: "dense" });
  if (!shorts.length) return null;

  return (
    <div className="flow-grid gap-y-4" style={gridStyle}>
      {shorts.map((short) => (
        <ShortCard
          key={short.id}
          short={short}
          queue={shorts}
        />
      ))}
    </div>
  );
};

// --- Playlists Grid ---

interface ChannelPlaylistsGridProps {
  playlists: PlaylistSummary[];
}

export const ChannelPlaylistsGrid: React.FC<ChannelPlaylistsGridProps> = ({ playlists }) => {
  const gridStyle = useGridStyle({ gapRem: 1.5 });
  if (!playlists.length) return null;

  return (
    <div className="flow-grid gap-y-6" style={gridStyle}>
      {playlists.map((playlist) => (
        <PlaylistCard key={playlist.id} playlist={playlist} />
      ))}
    </div>
  );
};

// --- Posts Feed ---

interface ChannelPostsFeedProps {
  posts: PostSummary[];
}

export const ChannelPostsFeed: React.FC<ChannelPostsFeedProps> = ({ posts }) => {
  if (!posts.length) return null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
};
