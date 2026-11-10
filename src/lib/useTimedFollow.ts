import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { usePlayerStore } from "../store/usePlayerStore";
import { firstTimestampSeconds, timedAnchorIndex } from "./commentFilters";
import type { Comment } from "../types/video";

const READING_PAUSE_MS = 5_000;
const REPLIES_PAUSE_MS = 20_000;

/**
 * Moves the Timed list with the video. It scrolls only the list itself, so the page and the player
 * stay put, and holds off while someone reads so the list never moves under them. The anchor is
 * derived in the selector, so the position can tick as it likes and only a crossing re-renders.
 */
export function useTimedFollow(listRef: RefObject<HTMLElement | null>, comments: Comment[], enabled: boolean) {
  const seconds = useMemo(() => comments.map((comment) => firstTimestampSeconds(comment) ?? 0), [comments]);
  const anchor = usePlayerStore((state) => (enabled ? timedAnchorIndex(seconds, state.currentTime) : -1));
  const pausedUntilRef = useRef(0);

  // Before the first timestamp the list rests on its earliest row, at the end.
  const targetId = enabled ? (comments[anchor] ?? comments[comments.length - 1])?.id : undefined;

  useEffect(() => {
    const list = listRef.current;
    if (!list || !targetId || Date.now() < pausedUntilRef.current) return;
    const row = [...list.querySelectorAll<HTMLElement>("[data-comment-id]")].find(
      (element) => element.dataset.commentId === targetId,
    );
    if (!row) return;
    const top = list.scrollTop + row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTo({ top, behavior: "smooth" });
  }, [listRef, targetId]);

  const pauseForReading = useCallback(() => {
    pausedUntilRef.current = Date.now() + READING_PAUSE_MS;
  }, []);
  const pauseForReplies = useCallback(() => {
    pausedUntilRef.current = Date.now() + REPLIES_PAUSE_MS;
  }, []);

  return { anchorId: enabled ? comments[anchor]?.id : undefined, pauseForReading, pauseForReplies };
}
