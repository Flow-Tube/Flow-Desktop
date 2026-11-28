import { beforeEach, describe, expect, it, vi } from "vitest";
import { getComments } from "../lib/api/youtube";
import { commentSourceKey, readToTheEnd, useCommentsStore, type CommentSource } from "./useCommentsStore";
import { OLDEST_PAGE_LIMIT } from "../lib/commentFilters";
import { SEARCH_PAGE_LIMIT } from "../lib/commentSearch";
import type { Comment, CommentsResponse } from "../types/video";

vi.mock("../lib/api/youtube", () => ({ getComments: vi.fn(), getPostComments: vi.fn() }));

const page = (ids: string[], next: string | null): CommentsResponse => ({
  comments: ids.map((id): Comment => ({ id, author: "a", text: id })),
  nextPageToken: next,
});

describe("reading comments to their oldest", () => {
  it("reads every page to the end and merges repeats", async () => {
    const pages: Record<string, CommentsResponse> = {
      first: page(["c", "b"], "two"),
      two: page(["b", "a"], null),
    };
    const result = await readToTheEnd(async (token) => pages[token!]!, "first", () => false);
    expect(result.comments.map((c) => c.id)).toEqual(["c", "b", "a"]);
    expect(result.capped).toBe(false);
  });

  it("stops at the page limit and says older comments were left", async () => {
    const fetchPage = vi.fn(async (token: string | null) => page([`c${token}`], `${Number(token) + 1}`));
    const result = await readToTheEnd(fetchPage, "0", () => false);
    expect(fetchPage).toHaveBeenCalledTimes(OLDEST_PAGE_LIMIT);
    expect(result.comments).toHaveLength(OLDEST_PAGE_LIMIT);
    expect(result.capped).toBe(true);
  });

  it("keeps what arrived when a later page fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchPage = vi.fn(async (token: string | null) => {
      if (token === "two") throw new Error("offline");
      return page(["c"], "two");
    });
    const result = await readToTheEnd(fetchPage, "first", () => false);
    expect(result.comments.map((c) => c.id)).toEqual(["c"]);
    expect(result.capped).toBe(true);
    warn.mockRestore();
  });

  it("stops once the list it reads for is gone", async () => {
    let cancelled = false;
    const fetchPage = vi.fn(async () => {
      cancelled = true;
      return page(["c"], "more");
    });
    await readToTheEnd(fetchPage, "first", () => cancelled);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});

const video = (videoId: string): CommentSource => ({ kind: "video", videoId });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the shared comment list", () => {
  const fetchMock = vi.mocked(getComments);

  beforeEach(() => {
    for (const key of Object.keys(useCommentsStore.getState().entries)) {
      for (let i = 0; i < 8; i++) useCommentsStore.getState().close(key);
    }
    useCommentsStore.setState({ entries: {}, recent: [] });
    fetchMock.mockReset();
  });

  it("asks once when two places show the same video", async () => {
    fetchMock.mockResolvedValue(page(["a", "b"], "next"));
    useCommentsStore.getState().open(video("v1"));
    useCommentsStore.getState().open(video("v1"));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useCommentsStore.getState().entries["video:v1"]?.comments.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("merges a comment that a later page repeats", async () => {
    fetchMock.mockResolvedValueOnce(page(["a", "b"], "next")).mockResolvedValueOnce(page(["b", "c"], null));
    useCommentsStore.getState().open(video("v1"));
    await settle();
    await useCommentsStore.getState().loadMore("video:v1");
    const entry = useCommentsStore.getState().entries["video:v1"]!;
    expect(entry.comments.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(entry.nextPageToken).toBeNull();
  });

  it("drops a page that arrives after the sort changed", async () => {
    let finishFirst: (value: CommentsResponse) => void = () => {};
    fetchMock
      .mockReturnValueOnce(new Promise((resolve) => (finishFirst = resolve)))
      .mockResolvedValueOnce(page(["new"], null));
    useCommentsStore.getState().open(video("v1"));
    useCommentsStore.getState().selectSort("video:v1", "NEWEST");
    await settle();
    finishFirst(page(["top"], null));
    await settle();
    expect(useCommentsStore.getState().entries["video:v1"]?.comments.map((c) => c.id)).toEqual(["new"]);
  });

  it("keeps open threads when the panel closes and opens again", async () => {
    fetchMock.mockResolvedValue(page(["a"], null));
    const key = commentSourceKey(video("v1"));
    useCommentsStore.getState().open(video("v1"));
    await settle();
    useCommentsStore.getState().toggleFlag(key, "open", "a");
    useCommentsStore.getState().close(key);
    useCommentsStore.getState().open(video("v1"));
    expect(useCommentsStore.getState().entries[key]?.flags.open.a).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("forgets lists nothing shows as others open, never one still shown", async () => {
    fetchMock.mockResolvedValue(page(["a"], null));
    useCommentsStore.getState().open(video("shown"));
    for (const id of ["v1", "v2", "v3", "v4", "v5"]) {
      useCommentsStore.getState().open(video(id));
      useCommentsStore.getState().close(`video:${id}`);
    }
    const kept = Object.keys(useCommentsStore.getState().entries).sort();
    expect(kept).toEqual(["video:shown", "video:v2", "video:v3", "video:v4", "video:v5"]);
  });
});

describe("keep searching", () => {
  const fetchMock = vi.mocked(getComments);
  const store = () => useCommentsStore.getState();
  const matchesName = (comment: Comment) => comment.text.includes("name");

  beforeEach(() => {
    for (const key of Object.keys(store().entries)) {
      for (let i = 0; i < 8; i++) store().close(key);
    }
    useCommentsStore.setState({ entries: {}, recent: [] });
    fetchMock.mockReset();
  });

  it("reads pages until enough comments match", async () => {
    let next = 0;
    fetchMock.mockImplementation(async () => {
      next += 1;
      return page(Array.from({ length: 20 }, (_, i) => `p${next}c${i}${i < 7 ? " name" : ""}`), `t${next}`);
    });
    store().open(video("s1"));
    await settle();
    await store().searchMore("video:s1", matchesName, () => false);
    // The first page, then three more: 7 + 7 + 7 reaches 20 matches.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(store().entries["video:s1"]?.searching).toBe(false);
  });

  it("stops at the page limit when nothing matches", async () => {
    fetchMock.mockImplementation(async (_id, token) => page([`c${token ?? "first"}`], `${token ?? ""}x`));
    store().open(video("s2"));
    await settle();
    await store().searchMore("video:s2", matchesName, () => false);
    expect(fetchMock).toHaveBeenCalledTimes(1 + SEARCH_PAGE_LIMIT);
  });

  it("stops at the end of the list and when the search changes", async () => {
    fetchMock.mockResolvedValueOnce(page(["a"], "two")).mockResolvedValueOnce(page(["b"], null));
    store().open(video("s3"));
    await settle();
    await store().searchMore("video:s3", matchesName, () => false);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(page(["c"], "more"));
    store().open(video("s4"));
    await settle();
    let cancelled = false;
    fetchMock.mockImplementation(async () => {
      cancelled = true;
      return page(["d"], "more");
    });
    await store().searchMore("video:s4", matchesName, () => cancelled);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
