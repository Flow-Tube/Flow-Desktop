import { useCallback, useEffect, useState } from "react";
import { getComments, getPostComments } from "./api/youtube";
import type { Comment, CommentSort } from "../types/video";

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
  const [chosenSort, setChosenSort] = useState<{ key: string; token: string } | null>(null);
  const sortToken = chosenSort?.key === sourceKey ? chosenSort.token : null;
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
    if (!sortToken) setCountText(null);
    setReplies({});
    setRepliesLoading({});
    setRepliesNextToken({});
    setExpanded({});
    if (!sourceId) return;

    let cancelled = false;
    setLoading(true);
    fetchComments(sortToken)
      .then((res) => {
        if (cancelled) return;
        setComments(res.comments || []);
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
  }, [fetchComments, sourceId, sourceKey, sortToken]);

  /** Reloads the list in the order `token` names (Top or Newest). */
  const selectSort = useCallback(
    (token: string) => {
      setSortOptions((options) => options.map((option) => ({ ...option, selected: option.token === token })));
      setChosenSort({ key: sourceKey, token });
    },
    [sourceKey],
  );

  const loadMore = useCallback(async () => {
    if (!sourceId || !nextPageToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchComments(nextPageToken);
      setComments((prev) => [...prev, ...(res.comments || [])]);
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
        setReplies((prev) => ({ ...prev, [commentId]: [...(prev[commentId] || []), ...(res.comments || [])] }));
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
