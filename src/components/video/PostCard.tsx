import { useState } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { formatCount } from "../../lib/utils";
import { CommentsSection } from "../watch/CommentsSection";
import { LinkedText } from "../watch/LinkedText";
import { PostAttachment } from "./PostAttachment";
import { PostActions, PostAuthor } from "./PostParts";
import type { PostSummary } from "../../types/video";

const SIDE_PANEL_WIDTH = 440;

interface PostCardProps {
  post: PostSummary;
}

export function PostCard({ post }: PostCardProps) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const commentCount = formatCount(post.commentCountText);

  return (
    <motion.div
      layout
      className={`mx-auto mb-6 flex w-full items-stretch justify-center gap-0 ${
        commentsOpen ? "max-w-6xl" : "max-w-3xl"
      }`}
    >
      <motion.article
        layout
        className="min-w-0 flex-1 rounded-2xl border border-chrome-zinc-800/60 bg-surface p-4 transition-colors hover:border-chrome-zinc-700/80 sm:p-5"
      >
        <PostAuthor post={post} className="mb-3" />

        <div className="ps-0 sm:ps-[52px]">
          {post.textContent && (
            <LinkedText
              text={post.textContent}
              className="mb-3 block select-text whitespace-pre-wrap text-sm font-medium leading-relaxed text-chrome-zinc-100"
            />
          )}

          {post.attachment && <PostAttachment attachment={post.attachment} />}

          <PostActions
            post={post}
            commentsOpen={commentsOpen}
            onComments={() => setCommentsOpen((open) => !open)}
            className="mt-3"
          />
        </div>
      </motion.article>

      <motion.aside
        layout
        initial={{ width: 0, opacity: 0 }}
        animate={{ width: commentsOpen ? SIDE_PANEL_WIDTH : 0, opacity: commentsOpen ? 1 : 0 }}
        transition={{ type: "spring", bounce: 0, duration: 0.4 }}
        className={`min-h-0 overflow-hidden bg-surface-container-high ${
          commentsOpen ? "ms-4 rounded-2xl border border-outline-soft": ""
        }`}
      >
        {commentsOpen && (
          <div className="flex h-[min(720px,calc(100vh-120px))] w-full flex-col">
            <div className="flex items-center justify-between border-b border-outline-soft p-4">
              <div className="flex min-w-0 items-baseline gap-2">
                <h3 className="text-base font-medium text-chrome-neutral-200">{getString("shorts_comments_title")}</h3>
                {commentCount && <span className="text-sm font-semibold text-chrome-neutral-400">{commentCount}</span>}
              </div>
              <button
                type="button"
                aria-label={getString("post_close_comments")}
                onClick={() => setCommentsOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors hover:bg-surface-container-highest hover:text-chrome-neutral-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4">
              <CommentsSection
                videoId=""
                hideHeader
                postId={post.id}
                postCommentParams={post.commentEndpointParams}
              />
            </div>
          </div>
        )}
      </motion.aside>
    </motion.div>
  );
}
