import { describe, expect, it, vi } from "vitest";
import { readToTheEnd } from "./useVideoComments";
import { OLDEST_PAGE_LIMIT } from "./commentFilters";
import type { Comment, CommentsResponse } from "../types/video";

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
