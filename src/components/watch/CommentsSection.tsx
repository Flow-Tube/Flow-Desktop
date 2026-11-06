import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { CommentItem } from "./CommentItem";
import { useVideoComments } from "../../lib/useVideoComments";
import { useTimedComments } from "../../lib/useTimedComments";
import { useTimedFollow } from "../../lib/useTimedFollow";
import { useBoolPref } from "../../lib/usePreference";
import {
  COMMENT_FILTERS,
  commentSortFor,
  oldestCommentsFirst,
  timedCommentsInOrder,
  type CommentFilter,
} from "../../lib/commentFilters";
import { SETTINGS } from "../../lib/settings/schema";
import { usePlayerStore } from "../../store/usePlayerStore";
import { getString } from "../../lib/i18n/index";
import type { CommentSort } from "../../types/video";
import type { CommentsSectionProps } from "./types";

const FILTER_LABELS = {
  top: "comments_sort_top",
  newest: "comments_sort_newest",
  oldest: "comments_sort_oldest",
  timed: "comments_sort_timed",
} as const satisfies Record<CommentFilter, string>;

// YouTube names the orders in English; ours are named by their place in its list.
const sortLabel = (option: CommentSort, index: number) =>
  index === 0 ? getString("comments_sort_top") : index === 1 ? getString("comments_sort_newest") : option.title;

export function CommentsSection({
  videoId,
  hideHeader = false,
  postId,
  postCommentParams,
  fill = false,
  onClose,
}: CommentsSectionProps) {
  const thread = useVideoComments(videoId, { postId, postCommentParams });
  const [filter, setFilter] = useState<CommentFilter>("top");
  useEffect(() => setFilter("top"), [videoId]);
  // Community posts have no playback to follow and keep YouTube's own orders.
  const filtersShown = !postId && thread.sortOptions.length >= 2;
  const isTimed = filtersShown && filter === "timed";

  const timed = useTimedComments(videoId, thread.sortOptions, isTimed);
  const duration = usePlayerStore((s) => s.duration);
  const [follow, setFollow] = useBoolPref(SETTINGS.TIMED_COMMENTS_FOLLOW);
  const listRef = useRef<HTMLDivElement>(null);

  const comments = useMemo(() => {
    if (isTimed) return timedCommentsInOrder(timed.comments, duration);
    return filtersShown && filter === "oldest" ? oldestCommentsFirst(thread.comments) : thread.comments;
  }, [duration, filter, filtersShown, isTimed, thread.comments, timed.comments]);
  const { anchorId, pauseForReading, pauseForReplies } = useTimedFollow(listRef, comments, isTimed && follow);

  const chooseFilter = (next: CommentFilter) => {
    setFilter(next);
    if (next === "timed") return;
    const order = commentSortFor(thread.sortOptions, next);
    if (order && !order.selected) thread.selectSort(order.token);
  };

  const loading = isTimed ? timed.loading && comments.length === 0 : thread.loading;
  const hasMore = isTimed ? timed.hasMore : Boolean(thread.nextPageToken);
  const loadingMore = isTimed ? timed.loading : thread.loadingMore;
  const loadMore = isTimed ? timed.loadMore : thread.loadMore;
  const emptyText = isTimed ? getString("comments_no_timed") : getString("watch_no_comments");
  // The Timed list scrolls by itself, so following it never moves the page or the player.
  const listClass = fill ? "min-h-0 flex-1 overflow-y-auto pr-1" : isTimed ? "max-h-[70vh] overflow-y-auto pr-1" : "";

  return (
    <div className={fill ? "flex h-full flex-col gap-4" : "space-y-6 pt-4"}>
      {!hideHeader && (
        <div className="flex flex-wrap items-center gap-4">
          <h2 className={fill ? "text-base font-medium text-chrome-neutral-100" : "text-xl font-bold text-chrome-neutral-100"}>
            {thread.totalCount != null
              ? getString("watch_comments_total", thread.totalCount.toLocaleString())
              : `${thread.countText || thread.comments.length} ${getString("watch_comments")}`}
          </h2>
          {onClose && (
            <button
              type="button"
              aria-label={getString("close")}
              onClick={onClose}
              className="ml-auto grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100"
            >
              <X size={18} />
            </button>
          )}
          {filtersShown ? (
            <div className="flex flex-wrap gap-2">
              {COMMENT_FILTERS.map((option) => (
                <Chip key={option} active={filter === option} onClick={() => chooseFilter(option)}>
                  {getString(FILTER_LABELS[option])}
                </Chip>
              ))}
            </div>
          ) : (
            thread.sortOptions.length > 1 && (
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
            )
          )}
        </div>
      )}

      {isTimed && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-chrome-neutral-400">{getString("comments_timed_follow")}</span>
          <ToggleSwitch checked={follow} onChange={setFollow} />
        </div>
      )}

      {loading ? (
        <Loader2 className="animate-spin text-chrome-neutral-500" size={24} />
      ) : thread.disabled ? (
        <p className="text-sm text-chrome-neutral-500">{getString("watch_comments_disabled")}</p>
      ) : comments.length === 0 && !(isTimed && hasMore) ? (
        <p className="text-sm text-chrome-neutral-500">{emptyText}</p>
      ) : (
        <div
          ref={listRef}
          className={`space-y-6 ${listClass}`}
          onWheel={pauseForReading}
          onPointerDown={pauseForReading}
        >
          <div className="space-y-4">
            {comments.map((c, idx) => (
              <div
                key={c.id || `comment-${idx}`}
                data-comment-id={c.id}
                className={`flex flex-col rounded-lg transition-colors duration-200 ease-out ${
                  c.id === anchorId ? "bg-surface-container-high" : ""
                }`}
              >
                <CommentItem comment={c} />
                <div className="ml-14">
                  {(c.continuationToken || (c.replyCount != null && c.replyCount > 0)) && (
                    <button
                      onClick={() => {
                        if (!thread.expanded[c.id]) pauseForReplies();
                        void thread.toggleReplies(c.id, c.continuationToken);
                      }}
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

          {(hasMore || (isTimed && loadingMore)) && (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={loadMore}
                disabled={loadingMore}
                className="px-6 font-semibold"
              >
                {loadingMore ? (
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
