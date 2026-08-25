import React from "react";
import { ShelfScroller } from "../ui/ShelfScroller";
import { PostCard } from "../video/PostCard";
import type { PostSummary } from "../../types/video";

interface PostShelfProps {
  title: string;
  posts: PostSummary[];
}

export const PostShelf: React.FC<PostShelfProps> = ({
  title,
  posts,
}) => {
  if (!posts || posts.length === 0) return null;

  return (
    <div className="relative flex flex-col gap-4 py-4 border-b border-chrome-zinc-900 last:border-0">
      {/* Shelf Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-chrome-zinc-100 tracking-tight flex items-center gap-2">
          <span>{title}</span>
          <span className="text-xs text-chrome-zinc-500 font-semibold bg-chrome-zinc-900 border border-chrome-zinc-800/80 px-2 py-0.5 rounded-full">
            {posts.length}
          </span>
        </h2>
      </div>

      <ShelfScroller className="flex gap-4 px-3 -mx-3 pt-3 -mt-2 pb-3">
        {posts.map((post) => (
          <div
            key={post.id}
            className="w-[320px] sm:w-[480px] shrink-0 transform transition-transform duration-300 hover:translate-y-[-2px] flex"
          >
            {/* Force clean layout for cards in a row */}
            <div className="w-full h-full flex flex-col mb-0 select-text">
              <PostCard post={post} />
            </div>
          </div>
        ))}
      </ShelfScroller>
    </div>
  );
};
