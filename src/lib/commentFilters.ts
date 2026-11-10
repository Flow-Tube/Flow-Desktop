import type { Comment, CommentSort } from "../types/video";

export type CommentFilter = "top" | "newest" | "oldest" | "timed";

export const COMMENT_FILTERS: readonly CommentFilter[] = ["top", "newest", "oldest", "timed"];

/**
 * The order that serves a chip, matched by position because the titles arrive in YouTube's language.
 * YouTube serves two orders and no third: Oldest reads the chronological one and arranges what it has.
 */
export function commentSortFor(options: CommentSort[], filter: CommentFilter): CommentSort | undefined {
  return filter === "top" ? options[0] : options[1];
}

/** The orders Timed reads, in turn: Newest usually has more timestamps per page. */
export function timedCommentOrders(options: CommentSort[]): CommentSort[] {
  return [options[1], options[0]].filter((option): option is CommentSort => Boolean(option));
}

/** Where a comment first points in its video, in seconds, or null when it points nowhere. */
export function firstTimestampSeconds(comment: Comment): number | null {
  let first: { start: number; seconds: number } | null = null;
  for (const span of comment.richText?.spans ?? []) {
    if (span.target.kind !== "timestamp") continue;
    if (!first || span.start < first.start) first = { start: span.start, seconds: span.target.seconds };
  }
  return first?.seconds ?? null;
}

/**
 * The comments with a timestamp, latest position first, the most liked first at the same position.
 * A pinned comment takes its place like any other. YouTube also marks times past the end of the
 * video as positions, so those go once the duration is known.
 */
export function timedCommentsInOrder(comments: Comment[], durationSeconds: number): Comment[] {
  const timed: { comment: Comment; seconds: number }[] = [];
  for (const comment of comments) {
    const seconds = firstTimestampSeconds(comment);
    if (seconds !== null && (durationSeconds <= 0 || seconds <= durationSeconds)) timed.push({ comment, seconds });
  }
  timed.sort((a, b) => b.seconds - a.seconds || (b.comment.likeCount ?? 0) - (a.comment.likeCount ?? 0));
  return timed.map((entry) => entry.comment);
}

/** The index of the latest timestamp already passed, or -1 before the first one. */
export function timedAnchorIndex(secondsLatestFirst: number[], positionSeconds: number): number {
  const position = Math.floor(positionSeconds);
  let low = 0;
  let high = secondsLatestFirst.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((secondsLatestFirst[middle] ?? 0) <= position) high = middle;
    else low = middle + 1;
  }
  return low < secondsLatestFirst.length ? low : -1;
}

function ageInSeconds(publishedText: string | null | undefined): number {
  const lower = (publishedText ?? "").toLowerCase();
  const count = Number(lower.match(/\d+/)?.[0] ?? 0);
  if (lower.includes("second")) return count;
  if (lower.includes("minute")) return count * 60;
  if (lower.includes("hour")) return count * 3_600;
  if (lower.includes("day")) return count * 86_400;
  if (lower.includes("week")) return count * 604_800;
  if (lower.includes("month")) return count * 2_592_000;
  if (lower.includes("year")) return count * 31_536_000;
  return Number.MAX_SAFE_INTEGER;
}

/** Oldest arranges only the pages loaded so far, with pinned comments staying first. */
export function oldestCommentsFirst(comments: Comment[]): Comment[] {
  const pinned = comments.filter((comment) => comment.isPinned);
  const rest = comments.filter((comment) => !comment.isPinned);
  rest.sort((a, b) => ageInSeconds(b.publishedText) - ageInSeconds(a.publishedText));
  return [...pinned, ...rest];
}
