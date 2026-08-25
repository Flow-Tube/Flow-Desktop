import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ThumbsUp } from "lucide-react";
import { Button } from "../ui/Button";
import { useVideoComments } from "../../lib/useVideoComments";
import { linkifyText } from "../../lib/linkify";
import { formatCount } from "../../lib/utils";
import { getString } from "../../lib/i18n/index";
import { upgradeAvatarUrl } from "../../lib/thumbnails";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import type { CommentsSectionProps } from "./types";

/** Comment avatars arrive from YouTube at 88px; every other avatar in the app is
 * upgraded and proxied the same way, so they match instead of looking soft. */
function CommentAvatar({ src, author }: { src: string | null | undefined; author: string | null | undefined }) {
  const imageSrc = useProxiedImageUrl(upgradeAvatarUrl(src, 128));
  if (!imageSrc) return <>{author?.charAt(0)?.toUpperCase() || "?"}</>;
  return <img src={imageSrc} className="h-full w-full object-cover" alt="" loading="lazy" />;
}

function CommentText({ text, className = "text-sm mt-1 text-chrome-neutral-200 whitespace-pre-wrap" }: { text: string; className?: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const maxLength = 280;

  if (!text) return null;
  if (text.length <= maxLength) return <div className={className}>{linkifyText(text)}</div>;

  const displayedText = isExpanded ? text : text.slice(0, maxLength) + "...";
  return (
    <div className={className}>
      {linkifyText(displayedText)}{" "}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }}
        className="ml-1 cursor-pointer font-semibold text-primary hover:underline focus:outline-none"
      >
        {isExpanded ? getString("watch_read_less") : getString("watch_read_more")}
      </button>
    </div>
  );
}

export function CommentsSection({
  videoId,
  hideHeader = false,
  postId,
  postCommentParams,
}: CommentsSectionProps) {
  const navigate = useNavigate();
  const thread = useVideoComments(videoId, { postId, postCommentParams });

  return (
    <div className="space-y-6 pt-4">
      {!hideHeader && (
        <h2 className="text-xl font-bold text-chrome-neutral-100">
          {thread.countText || `${thread.comments.length}`} {getString("watch_comments")}
        </h2>
      )}

      {thread.loading ? (
        <Loader2 className="animate-spin text-chrome-neutral-500" size={24} />
      ) : thread.comments.length === 0 ? (
        <p className="text-sm text-chrome-neutral-500">{getString("watch_no_comments")}</p>
      ) : (
        <div className="space-y-6">
          <div className="space-y-4">
            {thread.comments.map((c, idx) => (
              <div key={c.id || `comment-${idx}`} className="flex gap-4">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-high text-sm font-bold text-chrome-neutral-400 ${
                    c.authorChannelId ? "cursor-pointer" : ""
                  }`}
                  onClick={() => c.authorChannelId && navigate(`/channel/${c.authorChannelId}`)}
                >
                  <CommentAvatar src={c.authorThumbnail} author={c.author} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-sm font-bold text-chrome-neutral-100">
                    <span
                      className={c.authorChannelId ? "cursor-pointer hover:text-primary transition-colors" : ""}
                      onClick={() => c.authorChannelId && navigate(`/channel/${c.authorChannelId}`)}
                    >
                      {c.author}
                    </span>{" "}
                    <span className="text-xs font-medium text-chrome-neutral-400">{c.publishedText}</span>
                  </div>
                  <CommentText text={c.text} />

                  <div className="mt-2 flex items-center gap-4 text-xs text-chrome-neutral-400">
                    {c.likeCount != null && c.likeCount > 0 && (
                      <span className="flex items-center gap-1 transition-colors hover:text-chrome-neutral-200">
                        <ThumbsUp size={12} /> {formatCount(c.likeCount)}
                      </span>
                    )}
                    {(c.continuationToken || (c.replyCount != null && c.replyCount > 0)) && (
                      <button
                        onClick={() => thread.toggleReplies(c.id, c.continuationToken)}
                        className="flex items-center gap-1 border-none bg-transparent p-0 text-xs font-semibold text-primary hover:underline"
                      >
                        {thread.expanded[c.id]
                          ? getString("watch_hide_replies")
                          : getString("watch_show_replies", c.replyCount ?? "")}
                      </button>
                    )}
                  </div>

                  {thread.expanded[c.id] && (
                    <div className="mt-4 space-y-4 border-l-2 border-chrome-neutral-800 pl-4">
                      {thread.replies[c.id]?.map((reply, rIdx) => (
                        <div key={reply.id || `reply-${rIdx}`} className="flex gap-3 text-xs">
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-high font-bold text-chrome-neutral-400 ${
                              reply.authorChannelId ? "cursor-pointer" : ""
                            }`}
                            onClick={() => reply.authorChannelId && navigate(`/channel/${reply.authorChannelId}`)}
                          >
                            <CommentAvatar src={reply.authorThumbnail} author={reply.author} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2 font-bold text-chrome-neutral-100">
                              <span
                                className={reply.authorChannelId ? "cursor-pointer hover:text-primary transition-colors" : ""}
                                onClick={() => reply.authorChannelId && navigate(`/channel/${reply.authorChannelId}`)}
                              >
                                {reply.author}
                              </span>{" "}
                              <span className="text-[10px] font-medium text-chrome-neutral-400">{reply.publishedText}</span>
                            </div>
                            <CommentText text={reply.text} className="mt-1 whitespace-pre-wrap font-normal text-chrome-neutral-200" />
                            {reply.likeCount != null && reply.likeCount > 0 && (
                              <div className="mt-1 flex items-center gap-1 text-[10px] text-chrome-neutral-400">
                                <ThumbsUp size={10} /> {formatCount(reply.likeCount)}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}

                      {thread.repliesLoading[c.id] && (
                        <div className="flex items-center gap-2 py-1 text-xs text-chrome-neutral-400">
                          <Loader2 className="animate-spin text-chrome-neutral-400" size={14} />
                          <span>{getString("watch_loading_replies")}</span>
                        </div>
                      )}

                      {!thread.repliesLoading[c.id] && thread.repliesNextToken[c.id] && (
                        <button
                          onClick={() => thread.loadReplies(c.id, thread.repliesNextToken[c.id]!)}
                          className="mt-2 block border-none bg-transparent p-0 text-[11px] font-bold text-primary hover:underline"
                        >
                          {getString("watch_show_more_replies")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {thread.nextPageToken && (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={thread.loadMore}
                disabled={thread.loadingMore}
                className="px-6 font-semibold"
              >
                {thread.loadingMore ? (
                  <>
                    <Loader2 className="animate-spin text-chrome-neutral-400" size={16} />
                    <span>{getString("watch_loading_more_comments")}</span>
                  </>
                ) : (
                  getString("watch_load_more_comments")
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default CommentsSection;
