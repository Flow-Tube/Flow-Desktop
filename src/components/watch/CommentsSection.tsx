import { Loader2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { CommentItem } from "./CommentItem";
import { useVideoComments } from "../../lib/useVideoComments";
import { getString } from "../../lib/i18n/index";
import type { CommentSort } from "../../types/video";
import type { CommentsSectionProps } from "./types";

// YouTube names the orders in English; ours are named by their place in its list.
const sortLabel = (option: CommentSort, index: number) =>
  index === 0 ? getString("comments_sort_top") : index === 1 ? getString("comments_sort_newest") : option.title;

export function CommentsSection({
  videoId,
  hideHeader = false,
  postId,
  postCommentParams,
}: CommentsSectionProps) {
  const thread = useVideoComments(videoId, { postId, postCommentParams });

  return (
    <div className="space-y-6 pt-4">
      {!hideHeader && (
        <div className="flex flex-wrap items-center gap-4">
          <h2 className="text-xl font-bold text-chrome-neutral-100">
            {thread.totalCount != null
              ? getString("watch_comments_total", thread.totalCount.toLocaleString())
              : `${thread.countText || thread.comments.length} ${getString("watch_comments")}`}
          </h2>
          {thread.sortOptions.length > 1 && (
            <div className="flex gap-2">
              {thread.sortOptions.map((option, index) => (
                <Chip
                  key={option.token}
                  active={option.selected}
                  onClick={() => !option.selected && thread.selectSort(option.token)}
                >
                  {sortLabel(option, index)}
                </Chip>
              ))}
            </div>
          )}
        </div>
      )}

      {thread.loading ? (
        <Loader2 className="animate-spin text-chrome-neutral-500" size={24} />
      ) : thread.disabled ? (
        <p className="text-sm text-chrome-neutral-500">{getString("watch_comments_disabled")}</p>
      ) : thread.comments.length === 0 ? (
        <p className="text-sm text-chrome-neutral-500">{getString("watch_no_comments")}</p>
      ) : (
        <div className="space-y-6">
          <div className="space-y-4">
            {thread.comments.map((c, idx) => (
              <div key={c.id || `comment-${idx}`} className="flex flex-col">
                <CommentItem comment={c} />
                <div className="ml-14">
                  {(c.continuationToken || (c.replyCount != null && c.replyCount > 0)) && (
                    <button
                      onClick={() => thread.toggleReplies(c.id, c.continuationToken)}
                      className="mt-2 flex items-center gap-1 border-none bg-transparent p-0 text-xs font-semibold text-primary hover:underline"
                    >
                      {thread.expanded[c.id]
                        ? getString("watch_hide_replies")
                        : getString("watch_show_replies", c.replyCount ?? "")}
                    </button>
                  )}

                  {thread.expanded[c.id] && (
                    <div className="mt-4 space-y-4 border-l-2 border-chrome-neutral-800 pl-4">
                      {thread.replies[c.id]?.map((reply, rIdx) => (
                        <CommentItem key={reply.id || `reply-${rIdx}`} comment={reply} reply />
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
