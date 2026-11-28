import { useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Heart, Pin, ThumbsUp } from "lucide-react";
import { ChannelLabel } from "../video/CardMeta";
import { LinkedText } from "./LinkedText";
import { CommentSearchTerms } from "./commentSearchTerms";
import { foundRanges } from "../../lib/commentSearch";
import { formatCount } from "../../lib/utils";
import { getString } from "../../lib/i18n/index";
import { upgradeAvatarUrl } from "../../lib/thumbnails";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import type { Comment } from "../../types/video";
import { isRtlText } from "../../lib/direction";
import { useBoolPref } from "../../lib/usePreference";
import { SETTINGS } from "../../lib/settings/schema";
import type { CommentImage as CommentImageValue } from "../../types/video";

/** Comment avatars arrive from YouTube at 88px; every other avatar in the app is
 * upgraded and proxied the same way, so they match instead of looking soft. */
function CommentAvatar({ src, author }: { src: string | null | undefined; author: string | null | undefined }) {
  const imageSrc = useProxiedImageUrl(upgradeAvatarUrl(src, 128));
  if (!imageSrc) return <>{author?.charAt(0)?.toUpperCase() || "?"}</>;
  return <img src={imageSrc} className="h-full w-full object-cover" alt="" loading="lazy" />;
}

/**
 * The comment's text, clamped at four lines until it is read in full. "Read more" shows only when
 * the text really runs past them, and a click on its plain text opens it too; links keep working
 * while it is clamped. A comment the search found something in shows in full, with the finds marked.
 */
function CommentText({
  comment,
  className,
  expanded,
  onExpand,
}: {
  comment: Comment;
  className: string;
  expanded: boolean;
  onExpand: () => void;
}) {
  const textRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const terms = useContext(CommentSearchTerms);
  const found = useMemo(() => foundRanges(comment.text, terms), [comment.text, terms]);
  const open = expanded || found.length > 0;
  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element || open) return;
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, comment.text]);

  const text = comment.text;
  if (!text) return null;
  const clamped = !open && overflowing;
  return (
    <>
      <div
        ref={textRef}
        // From the text itself: dir="auto" would skip the text, which sets its own direction.
        dir={isRtlText(text) ? "rtl" : "ltr"}
        className={`${className} ${open ? "" : "line-clamp-4"} ${clamped ? "cursor-pointer" : ""}`}
        onClick={clamped ? onExpand : undefined}
      >
        <LinkedText text={text} rich={comment.richText} found={found} />
      </div>
      {clamped && (
        <button
          type="button"
          onClick={onExpand}
          className="mt-1 text-xs font-semibold text-chrome-neutral-400 transition-colors hover:text-chrome-neutral-100"
        >
          {getString("watch_read_more")}
        </button>
      )}
    </>
  );
}

/**
 * The creator's heart: their avatar with a red heart on its corner, or the heart alone when no
 * avatar is known.
 */
function CreatorHeart({ avatar, label }: { avatar: string | null | undefined; label: string }) {
  const src = useProxiedImageUrl(upgradeAvatarUrl(avatar, 48));
  if (!src) {
    return (
      <span title={label} aria-label={label} className="inline-flex">
        <Heart size={13} className="fill-creator-heart text-creator-heart" />
      </span>
    );
  }
  return (
    <span title={label} aria-label={label} className="relative inline-flex h-[18px] w-[18px] shrink-0">
      <img src={src} alt="" loading="lazy" className="h-full w-full rounded-full object-cover" />
      <Heart size={10} className="absolute -bottom-0.5 -end-1 fill-creator-heart text-creator-heart" />
    </span>
  );
}

/** Tallest a GIF is drawn; wider ones keep their shape below this. */
const GIF_MAX_HEIGHT = 240;

/** A GIF attached to a comment, at its own aspect ratio, loaded once it scrolls near. */
function CommentGif({ image }: { image: CommentImageValue }) {
  const [shown] = useBoolPref(SETTINGS.COMMENT_GIFS_ENABLED, true);
  const src = useProxiedImageUrl(shown ? image.url : null);
  if (!shown) return null;
  const height = Math.min(image.height, GIF_MAX_HEIGHT);
  const width = Math.round((image.width * height) / image.height);
  return (
    <div
      className="mt-2 max-w-full overflow-hidden rounded-lg bg-surface-container-high"
      style={{ width, aspectRatio: `${image.width} / ${image.height}` }}
    >
      {src && <img src={src} alt={getString("comment_gif")} loading="lazy" className="h-full w-full object-cover" />}
    </div>
  );
}

interface CommentItemProps {
  comment: Comment;
  reply?: boolean;
  /** The creator's avatar for a heart that came without one, as replies' hearts do. */
  creatorAvatar?: string | null;
  textExpanded: boolean;
  onExpandText: () => void;
  children?: ReactNode;
}

/**
 * One comment or reply: author line with its badges, text, likes and the creator's heart.
 * `children` sit under the likes, in the text column.
 */
export function CommentItem({ comment, reply = false, creatorAvatar, textExpanded, onExpandText, children }: CommentItemProps) {
  const navigate = useNavigate();
  const openAuthor = () => comment.authorChannelId && navigate(`/channel/${comment.authorChannelId}`);
  const likes = comment.likeCountText || (comment.likeCount ? formatCount(comment.likeCount) : null);

  return (
    <div className={`flex ${reply ? "gap-2 text-xs" : "gap-3"}`}>
      <div
        className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-high font-bold text-chrome-neutral-400 ${
          reply ? "h-6 w-6 text-[10px]" : "h-10 w-10 text-sm"
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
          <span dir="auto" className={`font-medium text-chrome-neutral-400 ${reply ? "text-[10px]" : "text-xs"}`}>
            {comment.publishedText}
          </span>
        </div>
        <CommentText
          comment={comment}
          className={`mt-1 select-text text-chrome-neutral-200 ${reply ? "font-normal" : "text-sm"}`}
          expanded={textExpanded}
          onExpand={onExpandText}
        />
        {comment.image && <CommentGif image={comment.image} />}
        {(likes || comment.isHearted) && (
          <div className={`mt-2 flex items-center gap-3 text-chrome-neutral-400 ${reply ? "text-[10px]" : "text-xs"}`}>
            {likes && (
              <span className="flex items-center gap-1">
                <ThumbsUp size={reply ? 10 : 12} /> {likes}
              </span>
            )}
            {comment.isHearted && (
              <CreatorHeart
                avatar={comment.creatorHeartThumbnail ?? creatorAvatar}
                label={comment.heartedByText ?? getString("comment_hearted")}
              />
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
