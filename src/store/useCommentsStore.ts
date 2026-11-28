import { create } from "zustand";
import { getComments, getPostComments, getShortComments } from "../lib/api/youtube";
import { mergeCommentsById, OLDEST_PAGE_LIMIT } from "../lib/commentFilters";
import { SEARCH_MATCH_TARGET, SEARCH_PAGE_LIMIT } from "../lib/commentSearch";
import type { Comment, CommentSort, CommentsResponse } from "../types/video";

/** Where a comment list comes from: a video's comment section, a Short's, or a community post's. */
export type CommentSource =
  | { kind: "video"; videoId: string }
  | { kind: "short"; videoId: string }
  | { kind: "post"; postId: string; params: string | null };

/** Comment-level switches kept with the list: an open thread, an unfolded deep reply, a long text read in full. */
export type CommentFlag = "open" | "unfolded" | "textExpanded";

export interface CommentsEntry {
  source: CommentSource;
  comments: Comment[];
  loading: boolean;
  nextPageToken: string | null;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  countText: string | null;
  totalCount: number | null;
  disabled: boolean;
  sortOptions: CommentSort[];
  /** The order chosen in this list; null is YouTube's default first page. */
  sortToken: string | null;
  /** The chosen order is read to its end for Oldest to turn around. */
  oldest: boolean;
  /** Oldest stopped at its page limit with older comments left unread. */
  oldestCapped: boolean;
  /** Keep searching is reading more pages. */
  searching: boolean;
  replies: Record<string, Comment[]>;
  repliesLoading: Record<string, boolean>;
  repliesNextToken: Record<string, string | null>;
  flags: Record<CommentFlag, Record<string, boolean>>;
  /** Bumped by every reload, so a page that belongs to an earlier one is dropped. */
  generation: number;
}

/**
 * Lists kept once nothing shows them. The watch column, the fullscreen panel and a reopened panel
 * read the same video's list; these cover going back to a video or a post just closed.
 */
const MAX_UNUSED_ENTRIES = 3;

/** How many mounted readers each list has; a list someone reads is never dropped. */
const readers = new Map<string, number>();

export function commentSourceKey(source: CommentSource): string {
  return source.kind === "post" ? `post:${source.postId}:${source.params ?? ""}` : `${source.kind}:${source.videoId}`;
}

function fetchPage(source: CommentSource, token: string | null): Promise<CommentsResponse> {
  if (source.kind === "post") return getPostComments(source.postId, source.params, token);
  return source.kind === "short" ? getShortComments(source.videoId, token) : getComments(source.videoId, token);
}

/**
 * Reads the order `token` names page after page, one request at a time, to its end or
 * [OLDEST_PAGE_LIMIT] pages, for Oldest to turn around. A page that fails ends the walk with what
 * has arrived. `capped` is true when older comments were left unread.
 */
export async function readToTheEnd(
  fetch: (token: string | null) => Promise<CommentsResponse>,
  token: string,
  cancelled: () => boolean,
): Promise<{ first: CommentsResponse; comments: Comment[]; capped: boolean }> {
  const first = await fetch(token);
  let comments = mergeCommentsById([], first.comments ?? []);
  let next = first.nextPageToken || null;
  for (let pages = 1; next && pages < OLDEST_PAGE_LIMIT && !cancelled(); pages++) {
    try {
      const page = await fetch(next);
      comments = mergeCommentsById(comments, page.comments ?? []);
      next = page.nextPageToken || null;
    } catch (error) {
      console.warn("Stopped reading comments to their oldest", error);
      break;
    }
  }
  return { first, comments, capped: Boolean(next) };
}

function emptyEntry(source: CommentSource): CommentsEntry {
  return {
    source,
    comments: [],
    loading: true,
    nextPageToken: null,
    loadingMore: false,
    loadMoreFailed: false,
    countText: null,
    totalCount: null,
    disabled: false,
    sortOptions: [],
    sortToken: null,
    oldest: false,
    oldestCapped: false,
    searching: false,
    replies: {},
    repliesLoading: {},
    repliesNextToken: {},
    flags: { open: {}, unfolded: {}, textExpanded: {} },
    generation: 0,
  };
}

interface CommentsState {
  entries: Record<string, CommentsEntry>;
  /** Keys from least to most recently opened. */
  recent: string[];
  /**
   * Starts reading `source`'s list, loading its first page unless it is already there or on its
   * way. Every `open` is paired with a `close` of the same key.
   */
  open: (source: CommentSource) => void;
  close: (key: string) => void;
  /** Reloads the list in the order `token` names; with `toOldest`, reads it to its end for Oldest. */
  selectSort: (key: string, token: string, toOldest?: boolean) => void;
  loadMore: (key: string) => Promise<void>;
  /**
   * Keep searching: reads up to [SEARCH_PAGE_LIMIT] more pages of the list's order, one at a time,
   * until [SEARCH_MATCH_TARGET] more comments pass `matches`, the list ends, a page fails, the list
   * is reloaded or `cancelled` says the search changed.
   */
  searchMore: (key: string, matches: (comment: Comment) => boolean, cancelled: () => boolean) => Promise<void>;
  /** Opens or closes a thread, loading its first replies the first time. */
  toggleReplies: (key: string, commentId: string, token: string | null | undefined) => Promise<void>;
  loadReplies: (key: string, commentId: string, token: string) => Promise<void>;
  toggleFlag: (key: string, flag: CommentFlag, commentId: string) => void;
}

export const useCommentsStore = create<CommentsState>((set, get) => {
  /** Applies `change` to `key`'s list, unless it is gone or was reloaded since `generation`. */
  const patch = (key: string, generation: number | null, change: (entry: CommentsEntry) => Partial<CommentsEntry>) =>
    set((state) => {
      const entry = state.entries[key];
      if (!entry || (generation !== null && entry.generation !== generation)) return state;
      return { entries: { ...state.entries, [key]: { ...entry, ...change(entry) } } };
    });

  const loadFirstPage = async (key: string) => {
    const entry = get().entries[key];
    if (!entry) return;
    const { source, sortToken, oldest, generation } = entry;
    const stale = () => get().entries[key]?.generation !== generation;
    try {
      // Oldest shows everything it read at once; nothing pages in after it.
      const page: CommentsResponse & { capped?: boolean } =
        oldest && sortToken
          ? await readToTheEnd((token) => fetchPage(source, token), sortToken, stale).then(
              ({ first, comments, capped }) => ({ ...first, comments, nextPageToken: null, capped }),
            )
          : await fetchPage(source, sortToken);
      patch(key, generation, (current) => ({
        loading: false,
        comments: mergeCommentsById([], page.comments ?? []),
        nextPageToken: page.nextPageToken || null,
        oldestCapped: Boolean(page.capped),
        countText: page.commentCountText || current.countText,
        totalCount: page.totalCount ?? current.totalCount,
        sortOptions: page.sortOptions?.length ? page.sortOptions : current.sortOptions,
        disabled: Boolean(page.commentsDisabled),
      }));
    } catch (error) {
      console.warn("Failed to load comments", error);
      patch(key, generation, () => ({ loading: false, comments: [], nextPageToken: null }));
    }
  };

  return {
    entries: {},
    recent: [],

    open: (source) => {
      const key = commentSourceKey(source);
      readers.set(key, (readers.get(key) ?? 0) + 1);
      const known = Boolean(get().entries[key]);
      set((state) => {
        const recent = [...state.recent.filter((existing) => existing !== key), key];
        const unused = recent.filter((existing) => !readers.get(existing));
        const dropped = new Set(unused.slice(0, Math.max(0, unused.length - MAX_UNUSED_ENTRIES)));
        const entries = { ...state.entries };
        for (const old of dropped) delete entries[old];
        if (!known) entries[key] = emptyEntry(source);
        return { entries, recent: recent.filter((existing) => !dropped.has(existing)) };
      });
      if (!known) void loadFirstPage(key);
    },

    close: (key) => {
      const count = (readers.get(key) ?? 0) - 1;
      if (count > 0) readers.set(key, count);
      else readers.delete(key);
    },

    selectSort: (key, token, toOldest = false) => {
      const entry = get().entries[key];
      if (!entry || (entry.sortToken === token && entry.oldest === toOldest)) return;
      patch(key, null, (current) => ({
        ...emptyEntry(current.source),
        countText: current.countText,
        totalCount: current.totalCount,
        sortOptions: current.sortOptions.map((option) => ({ ...option, selected: option.token === token })),
        sortToken: token,
        oldest: toOldest,
        generation: current.generation + 1,
      }));
      void loadFirstPage(key);
    },

    loadMore: async (key) => {
      const entry = get().entries[key];
      if (!entry?.nextPageToken || entry.loadingMore || entry.loading) return;
      const { generation, nextPageToken, source } = entry;
      patch(key, generation, () => ({ loadingMore: true, loadMoreFailed: false }));
      try {
        const page = await fetchPage(source, nextPageToken);
        patch(key, generation, (current) => ({
          loadingMore: false,
          comments: mergeCommentsById(current.comments, page.comments ?? []),
          nextPageToken: page.nextPageToken || null,
          countText: page.commentCountText || current.countText,
        }));
      } catch (error) {
        console.error("Failed to load more comments", error);
        patch(key, generation, () => ({ loadingMore: false, loadMoreFailed: true }));
      }
    },

    searchMore: async (key, matches, cancelled) => {
      const entry = get().entries[key];
      if (!entry?.nextPageToken || entry.loading || entry.loadingMore || entry.searching) return;
      const { generation } = entry;
      patch(key, generation, () => ({ searching: true }));
      let found = 0;
      for (let pages = 0; pages < SEARCH_PAGE_LIMIT && found < SEARCH_MATCH_TARGET && !cancelled(); pages++) {
        const before = get().entries[key]?.comments.length ?? 0;
        await get().loadMore(key);
        const current = get().entries[key];
        if (!current || current.generation !== generation || current.loadMoreFailed) break;
        found += current.comments.slice(before).filter(matches).length;
        if (!current.nextPageToken) break;
      }
      patch(key, generation, () => ({ searching: false }));
    },

    loadReplies: async (key, commentId, token) => {
      const entry = get().entries[key];
      if (!entry || entry.repliesLoading[commentId]) return;
      const { generation, source } = entry;
      patch(key, generation, (current) => ({ repliesLoading: { ...current.repliesLoading, [commentId]: true } }));
      try {
        const page = await fetchPage(source, token);
        patch(key, generation, (current) => ({
          replies: {
            ...current.replies,
            [commentId]: mergeCommentsById(current.replies[commentId] ?? [], page.comments ?? []),
          },
          repliesNextToken: { ...current.repliesNextToken, [commentId]: page.nextPageToken || null },
        }));
      } catch (error) {
        console.error(`Failed to load replies for comment ${commentId}`, error);
      } finally {
        patch(key, generation, (current) => ({ repliesLoading: { ...current.repliesLoading, [commentId]: false } }));
      }
    },

    toggleReplies: async (key, commentId, token) => {
      const entry = get().entries[key];
      if (!entry) return;
      const opening = !entry.flags.open[commentId];
      get().toggleFlag(key, "open", commentId);
      if (opening && !entry.replies[commentId] && token) await get().loadReplies(key, commentId, token);
    },

    toggleFlag: (key, flag, commentId) =>
      patch(key, null, (current) => ({
        flags: { ...current.flags, [flag]: { ...current.flags[flag], [commentId]: !current.flags[flag][commentId] } },
      })),
  };
});
