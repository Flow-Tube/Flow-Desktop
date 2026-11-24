import React from "react";
import { ShelfScroller } from "../ui/ShelfScroller";
import { PostShelfCard } from "../video/PostShelfCard";
import type { PostSummary } from "../../types/video";
import { hoverMotion } from "../../lib/platform";

interface PostShelfProps {
  title: string;
  /** Shown at the end of the header, such as a "See all" button. */
  action?: React.ReactNode;
  posts: PostSummary[];
}

export const PostShelf: React.FC<PostShelfProps> = ({
  title,
  action,
  posts,
}) => {
  if (!posts || posts.length === 0) return null;

  return (
    <div className="relative flex flex-col gap-4 py-4 border-b border-chrome-zinc-900 last:border-0">
      {/* Shelf Header */}
      <div className="flex items-center justify-between">
        <h2 dir="auto" className="text-lg font-bold tracking-tight text-chrome-zinc-100">{title}</h2>
        {action}
      </div>

      <ShelfScroller className="flex gap-4 px-3 -mx-3 pt-3 -mt-2 pb-3">
        {posts.map((post) => (
          <div
            key={post.id}
            className={`flex w-[320px] sm:w-[480px] shrink-0 ${hoverMotion("transform transition-transform duration-300 hover:translate-y-[-2px]")}`}
          >
            <PostShelfCard post={post} />
          </div>
        ))}
      </ShelfScroller>
    </div>
  );
};
