import { useCallback, useEffect, useRef, useState } from "react";
import { getComments } from "./api/youtube";
import { timedCommentOrders } from "./commentFilters";
import type { Comment, CommentSort } from "../types/video";

/**
 * Pages read per order when Timed opens and on each Load more. It never pages further by itself: only
 * a few comments in a hundred carry a timestamp, so chasing the list's end could walk the whole section.
 */
const OPENING_PAGES_PER_ORDER = 8;
const MORE_PAGES_PER_ORDER = 2;

/** Reads YouTube's two orders in turn into one list, since neither has every timestamped comment. */
export function useTimedComments(videoId: string, sortOptions: CommentSort[], active: boolean) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursorsRef = useRef<(string | null)[]>([]);
  const walkRef = useRef(0);

  const walk = useCallback(
    async (pagesPerOrder: number) => {
      const walkId = ++walkRef.current;
      setLoading(true);
      try {
        for (let page = 0; page < pagesPerOrder; page++) {
          for (let index = 0; index < cursorsRef.current.length; index++) {
            const cursor = cursorsRef.current[index];
            if (!cursor) continue;
            const result = await getComments(videoId, cursor);
            if (walkRef.current !== walkId) return;
            cursorsRef.current[index] = result.nextPageToken || null;
            const incoming = result.comments ?? [];
            setComments((previous) => {
              const known = new Set(previous.map((comment) => comment.id));
              return [...previous, ...incoming.filter((comment) => !comment.id || !known.has(comment.id))];
            });
            setHasMore(cursorsRef.current.some(Boolean));
          }
        }
      } catch (error) {
        // What has arrived stays on screen, and Load more can try again.
        console.warn("Failed to read timed comments", error);
      } finally {
        if (walkRef.current === walkId) setLoading(false);
      }
    },
    [videoId],
  );

  const orders = active ? timedCommentOrders(sortOptions).map((order) => order.token).join("|") : "";
  useEffect(() => {
    if (!orders) return;
    cursorsRef.current = orders.split("|");
    setComments([]);
    setHasMore(false);
    void walk(OPENING_PAGES_PER_ORDER);
    const walks = walkRef;
    return () => {
      walks.current++;
      setLoading(false);
    };
  }, [orders, walk]);

  const loadMore = useCallback(() => void walk(MORE_PAGES_PER_ORDER), [walk]);

  return { comments, loading, hasMore, loadMore };
}
