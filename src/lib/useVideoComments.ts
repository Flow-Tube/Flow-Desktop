import { useCallback, useEffect, useMemo } from "react";
import { commentSourceKey, useCommentsStore, type CommentFlag, type CommentSource } from "../store/useCommentsStore";

interface UseVideoCommentsOptions {
  /** The video is a Short, whose comments come from its reel's own panel. */
  short?: boolean;
  postId?: string | null;
  postCommentParams?: string | null;
}

const NO_FLAGS: Record<string, boolean> = {};

/**
 * A video's or a post's comment list, shared by everything that shows it: the watch column and the
 * fullscreen panel read one list, with one request per page and the same open threads.
 */
export function useVideoComments(videoId: string | undefined, options: UseVideoCommentsOptions = {}) {
  const postId = options.postId?.trim() || null;
  const postCommentParams = options.postCommentParams?.trim() || null;
  const short = Boolean(options.short);
  const source = useMemo<CommentSource | null>(() => {
    if (postId) return { kind: "post", postId, params: postCommentParams };
    if (!videoId) return null;
    return short ? { kind: "short", videoId } : { kind: "video", videoId };
  }, [postId, postCommentParams, short, videoId]);
  const key = source ? commentSourceKey(source) : "";
  const entry = useCommentsStore((state) => state.entries[key]);
  const store = useCommentsStore.getState;

  useEffect(() => {
    if (!source) return;
    store().open(source);
    return () => store().close(commentSourceKey(source));
  }, [source, store]);

  const selectSort = useCallback((token: string, toOldest = false) => store().selectSort(key, token, toOldest), [key, store]);
  const loadMore = useCallback(() => store().loadMore(key), [key, store]);
  const toggleReplies = useCallback(
    (commentId: string, token: string | null | undefined) => store().toggleReplies(key, commentId, token),
    [key, store],
  );
  const loadReplies = useCallback(
    (commentId: string, token: string) => store().loadReplies(key, commentId, token),
    [key, store],
  );
  const toggleFlag = useCallback(
    (flag: CommentFlag, commentId: string) => store().toggleFlag(key, flag, commentId),
    [key, store],
  );

  return {
    comments: entry?.comments ?? [],
    loading: entry ? entry.loading : Boolean(source),
    countText: entry?.countText ?? null,
    totalCount: entry?.totalCount ?? null,
    disabled: entry?.disabled ?? false,
    sortOptions: entry?.sortOptions ?? [],
    oldest: entry?.oldest ?? false,
    oldestCapped: entry?.oldestCapped ?? false,
    nextPageToken: entry?.nextPageToken ?? null,
    loadingMore: entry?.loadingMore ?? false,
    loadMoreFailed: entry?.loadMoreFailed ?? false,
    replies: entry?.replies ?? {},
    repliesLoading: entry?.repliesLoading ?? {},
    repliesNextToken: entry?.repliesNextToken ?? {},
    expanded: entry?.flags.open ?? NO_FLAGS,
    unfolded: entry?.flags.unfolded ?? NO_FLAGS,
    textExpanded: entry?.flags.textExpanded ?? NO_FLAGS,
    selectSort,
    loadMore,
    toggleReplies,
    loadReplies,
    toggleFlag,
  };
}
