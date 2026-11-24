import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { LoadMoreRow } from "../ui/LoadMoreRow";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { CommentItem } from "./CommentItem";
import { RepliesToggle, ReplyThread, ThreadStem, threadContentStart, threadCreatorAvatar } from "./CommentThread";
import { useVideoComments } from "../../lib/useVideoComments";
import { useTimedComments } from "../../lib/useTimedComments";
import { useTimedFollow } from "../../lib/useTimedFollow";
import { useBoolPref } from "../../lib/usePreference";
import {
  COMMENT_FILTERS,
  commentSortFor,
  oldestFirst,
  timedCommentsInOrder,
  type CommentFilter,
} from "../../lib/commentFilters";
import { SETTINGS } from "../../lib/settings/schema";
import { usePlayerStore } from "../../store/usePlayerStore";
import { getPlural, getString } from "../../lib/i18n/index";
import type { CommentsSectionProps } from "./types";

const FILTER_LABELS = {
  top: "comments_sort_top",
  newest: "comments_sort_newest",
  oldest: "comments_sort_oldest",
  timed: "comments_sort_timed",
} as const satisfies Record<CommentFilter, string>;

export function CommentsSection({
  videoId,
  hideHeader = false,
  short = false,
  postId,
  postCommentParams,
  fill = false,
  onClose,
}: CommentsSectionProps) {
  const thread = useVideoComments(videoId, { short, postId, postCommentParams });
  const [filter, setFilter] = useState<CommentFilter>("top");
  useEffect(() => setFilter("top"), [videoId, postId]);
  const filtersShown = thread.sortOptions.length >= 2;
  // Community posts have no playback for Timed to follow.
  const filters = postId ? COMMENT_FILTERS.filter((option) => option !== "timed") : COMMENT_FILTERS;
  const isTimed = filtersShown && !postId && filter === "timed";

  const timed = useTimedComments(videoId, thread.sortOptions, isTimed);
  const duration = usePlayerStore((s) => s.duration);
  const [follow, setFollow] = useBoolPref(SETTINGS.TIMED_COMMENTS_FOLLOW);
  const listRef = useRef<HTMLDivElement>(null);

  const comments = useMemo(() => {
    if (isTimed) return timedCommentsInOrder(timed.comments, duration);
    return filtersShown && filter === "oldest" ? oldestFirst(thread.comments) : thread.comments;
  }, [duration, filter, filtersShown, isTimed, thread.comments, timed.comments]);
  const { anchorId, pauseForReading, pauseForReplies } = useTimedFollow(listRef, comments, isTimed && follow);

  const chooseFilter = (next: CommentFilter) => {
    setFilter(next);
    if (next === "timed") return;
    const order = commentSortFor(thread.sortOptions, next);
    if (!order) return;
    if (next === "oldest") thread.selectSort(order.token, true);
    else if (!order.selected || thread.oldest) thread.selectSort(order.token);
  };
  const oldestNote =
    filtersShown && filter === "oldest" && thread.oldestCapped && !thread.loading
      ? getPlural("comments_oldest_capped", thread.comments.length)
      : null;

  const loading = isTimed ? timed.loading && comments.length === 0 : thread.loading;
  const hasMore = isTimed ? timed.hasMore : Boolean(thread.nextPageToken);
  const loadingMore = isTimed ? timed.loading : thread.loadingMore;
  const emptyText = isTimed ? getString("comments_no_timed") : getString("watch_no_comments");
  // The Timed list scrolls by itself, so following it never moves the page or the player.
  const listClass = fill ? "min-h-0 flex-1 overflow-y-auto pe-1" : isTimed ? "max-h-[70vh] overflow-y-auto pe-1" : "";

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
              className="ms-auto grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100"
            >
              <X size={18} />
            </button>
          )}
          {filtersShown && (
            <div className="flex flex-wrap gap-2">
              {filters.map((option) => (
                <Chip key={option} active={filter === option} onClick={() => chooseFilter(option)}>
                  {getString(FILTER_LABELS[option])}
                </Chip>
              ))}
            </div>
          )}
        </div>
      )}

      {oldestNote && <p className="-mt-2 text-xs text-chrome-neutral-400">{oldestNote}</p>}

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
                <div className="relative">
                  {thread.expanded[c.id] && Boolean(thread.replies[c.id]?.length) && <ThreadStem />}
                  <CommentItem
                    comment={c}
                    textExpanded={Boolean(thread.textExpanded[c.id])}
                    onExpandText={() => thread.toggleFlag("textExpanded", c.id)}
                  >
                    {/* YouTube's Timed list gives no way to load a comment's replies, so nothing to open. */}
                    {(c.replyCount ?? 0) > 0 && (c.continuationToken || thread.replies[c.id]?.length) && (
                      <RepliesToggle
                        count={c.replyCount ?? 0}
                        open={Boolean(thread.expanded[c.id])}
                        loading={Boolean(thread.repliesLoading[c.id]) && !thread.replies[c.id]?.length}
                        creatorAvatar={c.creatorReplyThumbnail}
                        creatorName={c.creatorReplyName}
                        onClick={() => {
                          if (!thread.expanded[c.id]) pauseForReplies();
                          void thread.toggleReplies(c.id, c.continuationToken);
                        }}
                      />
                    )}
                  </CommentItem>
                </div>

                {thread.expanded[c.id] &&
                  (thread.replies[c.id]?.length ? (
                    <ReplyThread
                      replies={thread.replies[c.id]!}
                      hasMore={Boolean(thread.repliesNextToken[c.id])}
                      loadingMore={Boolean(thread.repliesLoading[c.id])}
                      isUnfolded={(id) => Boolean(thread.unfolded[id])}
                      onUnfold={(id) => thread.toggleFlag("unfolded", id)}
                      onLoadMore={() => {
                        const token = thread.repliesNextToken[c.id];
                        if (token) void thread.loadReplies(c.id, token);
                      }}
                      creatorAvatar={threadCreatorAvatar(c, thread.replies[c.id])}
                      isTextExpanded={(id) => Boolean(thread.textExpanded[id])}
                      onExpandText={(id) => thread.toggleFlag("textExpanded", id)}
                    />
                  ) : (
                    thread.repliesLoading[c.id] && (
                      <div
                        className="flex items-center gap-2 py-2 text-xs text-chrome-neutral-400"
                        style={{ paddingInlineStart: threadContentStart(1) }}
                      >
                        <Loader2 className="animate-spin text-chrome-neutral-400" size={14} />
                        <span>{getString("watch_loading_replies")}</span>
                      </div>
                    )
                  ))}
              </div>
            ))}
          </div>

          {isTimed ? (
            (hasMore || loadingMore) && (
              <div className="flex justify-center pt-4">
                <Button variant="outline" onClick={timed.loadMore} disabled={loadingMore} className="px-6 font-semibold">
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
            )
          ) : (
            <LoadMoreRow
              hasMore={hasMore}
              loading={loadingMore}
              failed={thread.loadMoreFailed}
              onLoadMore={() => void thread.loadMore()}
              loadingText={getString("watch_loading_more_comments")}
              failedText={getString("comments_load_more_failed")}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default CommentsSection;
