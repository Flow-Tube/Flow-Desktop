import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Heart, Pin, ThumbsUp } from "lucide-react";
import { ChannelLabel } from "../video/CardMeta";
import { LinkedText } from "./LinkedText";
import { formatCount } from "../../lib/utils";
import { getString } from "../../lib/i18n/index";
import { upgradeAvatarUrl } from "../../lib/thumbnails";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import type { Comment } from "../../types/video";

const PREVIEW_LENGTH = 280;

/** Comment avatars arrive from YouTube at 88px; every other avatar in the app is
 * upgraded and proxied the same way, so they match instead of looking soft. */
function CommentAvatar({ src, author }: { src: string | null | undefined; author: string | null | undefined }) {
  const imageSrc = useProxiedImageUrl(upgradeAvatarUrl(src, 128));
  if (!imageSrc) return <>{author?.charAt(0)?.toUpperCase() || "?"}</>;
  return <img src={imageSrc} className="h-full w-full object-cover" alt="" loading="lazy" />;
}

/** A long comment shows its first lines with plain links until it is expanded. */
function CommentText({ comment, className }: { comment: Comment; className: string }) {
  const [expanded, setExpanded] = useState(false);
  const text = comment.text;
  if (!text) return null;
  const long = text.length > PREVIEW_LENGTH;
  return (
    <div className={className}>
      {long && !expanded ? (
        <LinkedText text={`${text.slice(0, PREVIEW_LENGTH)}...`} />
      ) : (
        <LinkedText text={text} rich={comment.richText} />
      )}
      {long && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
          className="ml-1 cursor-pointer font-semibold text-primary hover:underline focus:outline-none"
        >
          {expanded ? getString("watch_read_less") : getString("watch_read_more")}
        </button>
      )}
    </div>
  );
}

/** One comment or reply: author line with its badges, text, likes and the creator's heart. */
export function CommentItem({ comment, reply = false }: { comment: Comment; reply?: boolean }) {
  const navigate = useNavigate();
  const openAuthor = () => comment.authorChannelId && navigate(`/channel/${comment.authorChannelId}`);
  const likes = comment.likeCountText || (comment.likeCount ? formatCount(comment.likeCount) : null);

  return (
    <div className={`flex ${reply ? "gap-3 text-xs" : "gap-4"}`}>
      <div
        className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-high font-bold text-chrome-neutral-400 ${
          reply ? "h-8 w-8" : "h-10 w-10 text-sm"
        } ${comment.authorChannelId ? "cursor-pointer" : ""}`}
        onClick={openAuthor}
      >
        <CommentAvatar src={comment.authorThumbnail} author={comment.author} />
      </div>
      <div className="min-w-0 flex-1">
        {comment.isPinned && (
          <div className="mb-1 flex items-center gap-1 text-xs text-chrome-neutral-400">
            <Pin size={12} />
            <span>{comment.pinnedText || getString("comment_pinned")}</span>
          </div>
        )}
        <div className={`flex items-center gap-2 font-bold text-chrome-neutral-100 ${reply ? "" : "text-sm"}`}>
          <button
            type="button"
            onClick={openAuthor}
            className={`min-w-0 ${comment.isCreator ? "rounded-full bg-surface-container-high px-2 py-0.5" : ""} ${
              comment.authorChannelId ? "transition-colors hover:text-primary" : "cursor-default"
            }`}
          >
            <ChannelLabel name={comment.author} verified={comment.isVerified} artist={comment.isArtist} iconSize={12} />
          </button>
          <span className={`font-medium text-chrome-neutral-400 ${reply ? "text-[10px]" : "text-xs"}`}>
            {comment.publishedText}
          </span>
        </div>
        <CommentText
          comment={comment}
          className={`mt-1 text-chrome-neutral-200 ${reply ? "font-normal" : "text-sm"}`}
        />
        {(likes || comment.isHearted) && (
          <div className={`mt-2 flex items-center gap-3 text-chrome-neutral-400 ${reply ? "text-[10px]" : "text-xs"}`}>
            {likes && (
              <span className="flex items-center gap-1">
                <ThumbsUp size={reply ? 10 : 12} /> {likes}
              </span>
            )}
            {comment.isHearted && (
              <span title={comment.heartedByText ?? undefined} aria-label={comment.heartedByText ?? getString("comment_hearted")}>
                <Heart size={reply ? 11 : 13} className="fill-primary text-primary" />
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
