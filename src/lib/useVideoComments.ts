import { useCallback, useEffect, useState } from "react";
import { getComments, getPostComments } from "./api/youtube";
import { mergeCommentsById, OLDEST_PAGE_LIMIT } from "./commentFilters";
import type { Comment, CommentSort, CommentsResponse } from "../types/video";

/**
 * Reads the order `token` names page after page, one request at a time, to its end or
 * [OLDEST_PAGE_LIMIT] pages, for Oldest to turn around. A page that fails ends the walk with what
 * has arrived. `capped` is true when older comments were left unread.
 */
export async function readToTheEnd(
  fetchPage: (token: string | null) => Promise<CommentsResponse>,
  token: string,
  cancelled: () => boolean,
): Promise<{ first: CommentsResponse; comments: Comment[]; capped: boolean }> {
  const first = await fetchPage(token);
  let comments = mergeCommentsById([], first.comments ?? []);
  let next = first.nextPageToken || null;
  for (let pages = 1; next && pages < OLDEST_PAGE_LIMIT && !cancelled(); pages++) {
    try {
      const page = await fetchPage(next);
      comments = mergeCommentsById(comments, page.comments ?? []);
      next = page.nextPageToken || null;
    } catch (error) {
      console.warn("Stopped reading comments to their oldest", error);
      break;
    }
  }
  return { first, comments, capped: Boolean(next) };
}

interface UseVideoCommentsOptions {
  postId?: string | null;
  postCommentParams?: string | null;
}

export function useVideoComments(videoId: string | undefined, options: UseVideoCommentsOptions = {}) {
  const postId = options.postId?.trim() || null;
  const postCommentParams = options.postCommentParams?.trim() || null;
  const sourceId = postId ?? videoId;
  const sourceKey = postId ? `post:${postId}:${postCommentParams ?? ""}` : `video:${videoId ?? ""}`;
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [countText, setCountText] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [sortOptions, setSortOptions] = useState<CommentSort[]>([]);
  // The sort chosen for this source; any other source starts on YouTube's default first page.
  const [chosenSort, setChosenSort] = useState<{ key: string; token: string; oldest: boolean } | null>(null);
  const sortToken = chosenSort?.key === sourceKey ? chosenSort.token : null;
  const oldest = Boolean(sortToken && chosenSort?.oldest);
  const [oldestCapped, setOldestCapped] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [replies, setReplies] = useState<Record<string, Comment[]>>({});
  const [repliesLoading, setRepliesLoading] = useState<Record<string, boolean>>({});
  const [repliesNextToken, setRepliesNextToken] = useState<Record<string, string | null>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const fetchComments = useCallback(
    (pageToken?: string | null) => {
      if (postId) return getPostComments(postId, postCommentParams, pageToken);
      return getComments(videoId || "", pageToken);
    },
    [postId, postCommentParams, videoId],
  );

  useEffect(() => {
    setSortOptions([]);
    setTotalCount(null);
    setDisabled(false);
  }, [sourceKey]);

  useEffect(() => {
    setComments([]);
    setNextPageToken(null);
    setOldestCapped(false);
    if (!sortToken) setCountText(null);
    setReplies({});
    setRepliesLoading({});
    setRepliesNextToken({});
    setExpanded({});
    if (!sourceId) return;

    let cancelled = false;
    setLoading(true);
    // Oldest shows everything it read at once; nothing pages in after it.
    const load: Promise<CommentsResponse & { capped?: boolean }> =
      oldest && sortToken
        ? readToTheEnd(fetchComments, sortToken, () => cancelled).then(({ first, comments, capped }) => ({
            ...first,
            comments,
            nextPageToken: null,
            capped,
          }))
        : fetchComments(sortToken);
    load
      .then((res) => {
        if (cancelled) return;
        setComments(mergeCommentsById([], res.comments || []));
        setOldestCapped(Boolean(res.capped));
        setNextPageToken(res.nextPageToken || null);
        if (res.commentCountText) setCountText(res.commentCountText);
        if (res.totalCount != null) setTotalCount(res.totalCount);
        if (res.sortOptions?.length) setSortOptions(res.sortOptions);
        setDisabled(Boolean(res.commentsDisabled));
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("Failed to load comments", err);
        setComments([]);
        setNextPageToken(null);
        setCountText(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchComments, oldest, sourceId, sourceKey, sortToken]);

  /**
   * Reloads the list in the order `token` names (Top or Newest). With `toOldest`, reads that order to
   * its end so Oldest can turn it around.
   */
  const selectSort = useCallback(
    (token: string, toOldest = false) => {
      setSortOptions((options) => options.map((option) => ({ ...option, selected: option.token === token })));
      setChosenSort({ key: sourceKey, token, oldest: toOldest });
    },
    [sourceKey],
  );

  const loadMore = useCallback(async () => {
    if (!sourceId || !nextPageToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchComments(nextPageToken);
      setComments((prev) => mergeCommentsById(prev, res.comments || []));
      setNextPageToken(res.nextPageToken || null);
      if (res.commentCountText) setCountText(res.commentCountText);
    } catch (err) {
      console.error("Failed to load more comments", err);
    } finally {
      setLoadingMore(false);
    }
  }, [fetchComments, sourceId, nextPageToken, loadingMore]);

  const loadReplies = useCallback(
    async (commentId: string, replyToken: string) => {
      if (!sourceId || repliesLoading[commentId]) return;
      setRepliesLoading((prev) => ({ ...prev, [commentId]: true }));
      try {
        const res = await fetchComments(replyToken);
        setReplies((prev) => ({ ...prev, [commentId]: mergeCommentsById(prev[commentId] || [], res.comments || []) }));
        setRepliesNextToken((prev) => ({ ...prev, [commentId]: res.nextPageToken || null }));
      } catch (err) {
        console.error(`Failed to load replies for comment ${commentId}`, err);
      } finally {
        setRepliesLoading((prev) => ({ ...prev, [commentId]: false }));
      }
    },
    [fetchComments, sourceId, repliesLoading],
  );

  const toggleReplies = useCallback(
    async (commentId: string, replyToken: string | null | undefined) => {
      if (expanded[commentId]) {
        setExpanded((prev) => ({ ...prev, [commentId]: false }));
        return;
      }
      setExpanded((prev) => ({ ...prev, [commentId]: true }));
      if (!replies[commentId] && replyToken) await loadReplies(commentId, replyToken);
    },
    [expanded, replies, loadReplies],
  );

  return {
    comments,
    loading,
    countText,
    totalCount,
    disabled,
    sortOptions,
    selectSort,
    oldest,
    oldestCapped,
    nextPageToken,
    loadingMore,
    replies,
    repliesLoading,
    repliesNextToken,
    expanded,
    loadMore,
    toggleReplies,
    loadReplies,
  };
}
