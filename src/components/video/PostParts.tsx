import { MessageSquare, Share2, ThumbsUp } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { formatCount } from "../../lib/utils";
import { upgradeAvatarUrl, avatarSize } from "../../lib/thumbnails";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { youtubePostUrl } from "../../lib/youtubeUrl";
import { shareLink } from "../../lib/clipboard";
import { useUiStore } from "../../store/useUiStore";
import type { PostSummary } from "../../types/video";

const ACTION_PILL =
  "flex items-center gap-2 rounded-full bg-chrome-zinc-800/60 px-3 py-1.5 text-sm font-bold text-chrome-zinc-100";
const ACTION_BUTTON = `${ACTION_PILL} transition-colors duration-200 ease-out hover:bg-chrome-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`;

/** The author's avatar, name and when the post went up. */
export function PostAuthor({ post, className = "" }: { post: PostSummary; className?: string }) {
  const avatarUrl = useProxiedImageUrl(upgradeAvatarUrl(post.authorAvatar, avatarSize(40)));
  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`}>
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
        <span dir="auto" className="truncate text-sm font-bold text-chrome-zinc-100">{post.authorName}</span>
        {post.publishedTimeText && (
          <span className="shrink-0 text-xs text-chrome-zinc-500">{post.publishedTimeText}</span>
        )}
      </div>
    </div>
  );
}

/** Likes, Share and the comment count that opens the comments. */
export function PostActions({
  post,
  commentsOpen,
  onComments,
  className = "",
}: {
  post: PostSummary;
  commentsOpen: boolean;
  onComments: () => void;
  className?: string;
}) {
  const showToast = useUiStore((state) => state.showToast);
  const likeLabel = formatCount(post.likesCountText) || getString("like");
  const commentCount = formatCount(post.commentCountText);

  const sharePost = async () => {
    const title = post.textContent?.slice(0, 80) || post.authorName;
    const result = await shareLink(title, youtubePostUrl(post.id));
    if (result === "copied") showToast({ variant: "success", message: getString("shorts_link_copied") });
    if (result === "failed") showToast({ variant: "error", message: getString("share_link_copy_failed") });
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className={ACTION_PILL}>
        <ThumbsUp size={16} />
        <span>{likeLabel}</span>
      </span>

      <button type="button" onClick={() => void sharePost()} className={ACTION_BUTTON}>
        <Share2 size={16} />
        <span className="hidden sm:inline">{getString("share")}</span>
      </button>

      <button type="button" onClick={onComments} aria-expanded={commentsOpen} className={ACTION_BUTTON}>
        <MessageSquare size={16} />
        <span>{commentCount || getString("watch_comments")}</span>
      </button>
    </div>
  );
}
