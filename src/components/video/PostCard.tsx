import { useState } from "react";
import { motion } from "framer-motion";
import { MessageSquare, Share2, ThumbsUp, X } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { formatCount } from "../../lib/utils";
import { upgradeAvatarUrl } from "../../lib/thumbnails";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { youtubePostUrl } from "../../lib/youtubeUrl";
import { shareLink } from "../../lib/clipboard";
import { useUiStore } from "../../store/useUiStore";
import { CommentsSection } from "../watch/CommentsSection";
import { LinkedText } from "../watch/LinkedText";
import { PostAttachment } from "./PostAttachment";
import type { PostSummary } from "../../types/video";

const SIDE_PANEL_WIDTH = 440;

interface PostCardProps {
  post: PostSummary;
}

export function PostCard({ post }: PostCardProps) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const showToast = useUiStore((state) => state.showToast);
  const avatarUrl = useProxiedImageUrl(upgradeAvatarUrl(post.authorAvatar));
  const postUrl = youtubePostUrl(post.id);
  const likeLabel = formatCount(post.likesCountText) || getString("like");
  const commentCount = formatCount(post.commentCountText);

  const sharePost = async () => {
    const title = post.textContent?.slice(0, 80) || post.authorName;
    const result = await shareLink(title, postUrl);
    if (result === "copied") showToast({ variant: "success", message: getString("shorts_link_copied") });
    if (result === "failed") showToast({ variant: "error", message: getString("share_link_copy_failed") });
  };

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
        <div className="mb-3 flex items-start justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-chrome-zinc-800 bg-chrome-zinc-800">
              {avatarUrl ? (
                <img src={avatarUrl} alt={post.authorName} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center font-bold text-chrome-zinc-500">
                  {(post.authorName || "?").charAt(0)}
                </div>
              )}
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-bold text-chrome-zinc-100">{post.authorName}</span>
              {post.publishedTimeText && (
                <span className="shrink-0 text-xs text-chrome-zinc-500">{post.publishedTimeText}</span>
              )}
            </div>
          </div>
        </div>

        <div className="pl-0 sm:pl-[52px]">
          {post.textContent && (
            <LinkedText
              text={post.textContent}
              className="mb-3 block whitespace-pre-wrap text-sm font-medium leading-relaxed text-chrome-zinc-100"
            />
          )}

          {post.attachment && <PostAttachment attachment={post.attachment} />}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-2 rounded-full bg-chrome-zinc-800/60 px-3 py-1.5 text-sm font-bold text-chrome-zinc-100">
              <ThumbsUp size={16} />
              <span>{likeLabel}</span>
            </span>

            <button
              type="button"
              onClick={() => void sharePost()}
              className="flex items-center gap-2 rounded-full bg-chrome-zinc-800/60 px-3 py-1.5 text-sm font-bold text-chrome-zinc-100 transition-colors hover:bg-chrome-zinc-700"
            >
              <Share2 size={16} />
              <span className="hidden sm:inline">{getString("share")}</span>
            </button>

            <button
              type="button"
              onClick={() => setCommentsOpen((open) => !open)}
              aria-expanded={commentsOpen}
              className="flex items-center gap-2 rounded-full bg-chrome-zinc-800/60 px-3 py-1.5 text-sm font-bold text-chrome-zinc-100 transition-colors hover:bg-chrome-zinc-700"
            >
              <MessageSquare size={16} />
              <span>{commentCount || getString("watch_comments")}</span>
            </button>
          </div>
        </div>
      </motion.article>

      <motion.aside
        layout
        initial={{ width: 0, opacity: 0 }}
        animate={{ width: commentsOpen ? SIDE_PANEL_WIDTH : 0, opacity: commentsOpen ? 1 : 0 }}
        transition={{ type: "spring", bounce: 0, duration: 0.4 }}
        className={`min-h-0 overflow-hidden bg-surface-container-high ${
          commentsOpen ? "ml-4 rounded-2xl border border-chrome-neutral-800" : ""
        }`}
      >
        {commentsOpen && (
          <div className="flex h-[min(720px,calc(100vh-120px))] w-full flex-col">
            <div className="flex items-center justify-between border-b border-chrome-neutral-800 p-4">
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
            <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-4">
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
