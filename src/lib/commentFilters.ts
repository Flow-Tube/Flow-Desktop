import type { Comment, CommentSort } from "../types/video";

export type CommentFilter = "top" | "newest" | "oldest" | "timed";

export const COMMENT_FILTERS: readonly CommentFilter[] = ["top", "newest", "oldest", "timed"];

/**
 * Pages Oldest reads of the Newest order before turning it around, about 500 comments. YouTube has no
 * oldest-first order, so the only way to the oldest comment is the end of the newest-first one, which
 * on a big video is thousands of requests; past this the list says how far it reached.
 */
export const OLDEST_PAGE_LIMIT = 25;

/**
 * The order that serves a chip, matched by position because the titles arrive in YouTube's language.
 * YouTube serves Top and Newest; Oldest reads Newest to its end and turns it around.
 */
export function commentSortFor(options: CommentSort[], filter: CommentFilter): CommentSort | undefined {
  return filter === "top" ? options[0] : options[1];
}

/** `incoming` after `existing`, without comments already there: pages can repeat a comment. */
export function mergeCommentsById(existing: Comment[], incoming: Comment[]): Comment[] {
  const known = new Set(existing.map((comment) => comment.id).filter(Boolean));
  const added = incoming.filter((comment) => {
    if (!comment.id) return true;
    if (known.has(comment.id)) return false;
    known.add(comment.id);
    return true;
  });
  return added.length ? [...existing, ...added] : existing;
}

/** The orders Timed reads, in turn: Newest usually has more timestamps per page. */
export function timedCommentOrders(options: CommentSort[]): CommentSort[] {
  return [options[1], options[0]].filter((option): option is CommentSort => Boolean(option));
}

/**
 * Where a comment sits in its video, in seconds, or null when it points nowhere: the time YouTube's
 * Timed list gives it, else the first timestamp in its text.
 */
export function timedPositionSeconds(comment: Comment): number | null {
  if (comment.timedAtMs != null) return Math.floor(comment.timedAtMs / 1000);
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
    const seconds = timedPositionSeconds(comment);
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

/** Comments read newest first, turned around in the order they arrived; pinned ones stay on top. */
export function oldestFirst(comments: Comment[]): Comment[] {
  const pinned = comments.filter((comment) => comment.isPinned);
  const rest = comments.filter((comment) => !comment.isPinned).reverse();
  return [...pinned, ...rest];
}
