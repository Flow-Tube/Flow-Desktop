import { describe, expect, it } from "vitest";

import {
  END_OF_FEED_MISSES,
  createDiscoveryPaging,
  hasDiscoveryPagesLeft,
  isDiscoverFeedExhausted,
  recordDiscoveryPages,
  resetDiscoveryPaging,
  takeDiscoveryRequests,
  withDiscoveryQueries,
} from "./homeFeedPaging";

const pagingFor = (queries: string[], cursor = 0) =>
  resetDiscoveryPaging(createDiscoveryPaging(), queries, cursor);

describe("takeDiscoveryRequests", () => {
  it("asks for page one of queries that have not run yet", () => {
    const { requests, paging } = takeDiscoveryRequests(pagingFor(["a", "b", "c"]), 2);

    expect(requests).toEqual([{ query: "a" }, { query: "b" }]);
    expect(paging.cursor).toBe(2);
  });

  it("sends the stored continuation token when a query is reused", () => {
    let paging = pagingFor(["a", "b"]);
    paging = recordDiscoveryPages(paging, paging.epoch, [
      { query: "a", nextPageToken: "a-page-2" },
      { query: "b", nextPageToken: "b-page-2" },
    ]);

    expect(takeDiscoveryRequests(paging, 2).requests).toEqual([
      { query: "a", pageToken: "a-page-2" },
      { query: "b", pageToken: "b-page-2" },
    ]);
  });

  it("wraps around from the cursor and skips exhausted queries", () => {
    let paging = pagingFor(["a", "b", "c", "d", "e"], 4);
    paging = recordDiscoveryPages(paging, paging.epoch, [
      { query: "a", nextPageToken: null },
      { query: "b", nextPageToken: "b-page-2" },
    ]);

    const first = takeDiscoveryRequests(paging, 2);
    expect(first.requests).toEqual([{ query: "e" }, { query: "b", pageToken: "b-page-2" }]);

    const second = takeDiscoveryRequests(first.paging, 2);
    expect(second.requests).toEqual([{ query: "c" }, { query: "d" }]);
  });

  it("never repeats a query within one batch", () => {
    const { requests } = takeDiscoveryRequests(pagingFor(["a"]), 2);

    expect(requests).toEqual([{ query: "a" }]);
  });

  it("returns nothing once every query is out of pages", () => {
    let paging = pagingFor(["a", "b"]);
    paging = recordDiscoveryPages(paging, paging.epoch, [
      { query: "a", nextPageToken: null },
      { query: "b" },
    ]);

    expect(takeDiscoveryRequests(paging, 2).requests).toEqual([]);
    expect(hasDiscoveryPagesLeft(paging)).toBe(false);
  });
});

describe("recordDiscoveryPages", () => {
  it("drops results from a request started before a reset", () => {
    const stale = pagingFor(["a"]);
    const fresh = resetDiscoveryPaging(stale, ["a"]);

    const recorded = recordDiscoveryPages(fresh, stale.epoch, [{ query: "a", nextPageToken: null }]);

    expect(recorded).toBe(fresh);
    expect(hasDiscoveryPagesLeft(recorded)).toBe(true);
  });
});

describe("withDiscoveryQueries", () => {
  it("keeps a returning query exhausted so its first page is not replayed", () => {
    let paging = pagingFor(["a", "b"]);
    paging = recordDiscoveryPages(paging, paging.epoch, [
      { query: "a", nextPageToken: null },
      { query: "b", nextPageToken: null },
    ]);

    const regenerated = withDiscoveryQueries(paging, ["b", "c", " c ", ""]);

    expect(regenerated.queries).toEqual(["b", "c"]);
    expect(takeDiscoveryRequests(regenerated, 2).requests).toEqual([{ query: "c" }]);
  });

  it("stays exhausted when regeneration returns the same queries", () => {
    let paging = pagingFor(["a"]);
    paging = recordDiscoveryPages(paging, paging.epoch, [{ query: "a", nextPageToken: null }]);

    expect(hasDiscoveryPagesLeft(withDiscoveryQueries(paging, ["a"]))).toBe(false);
  });
});

describe("resetDiscoveryPaging", () => {
  it("forgets every token so a refresh starts from page one", () => {
    let paging = pagingFor(["a"]);
    paging = recordDiscoveryPages(paging, paging.epoch, [{ query: "a", nextPageToken: null }]);

    const reset = resetDiscoveryPaging(paging, ["a"]);

    expect(reset.epoch).toBe(paging.epoch + 1);
    expect(takeDiscoveryRequests(reset, 1).requests).toEqual([{ query: "a" }]);
  });
});

describe("isDiscoverFeedExhausted", () => {
  it("waits for repeated misses even when no pages are left", () => {
    let paging = pagingFor(["a"]);
    paging = recordDiscoveryPages(paging, paging.epoch, [{ query: "a", nextPageToken: null }]);

    expect(isDiscoverFeedExhausted(paging, END_OF_FEED_MISSES - 1)).toBe(false);
    expect(isDiscoverFeedExhausted(paging, END_OF_FEED_MISSES)).toBe(true);
  });

  it("is never the end while a query still has pages", () => {
    const paging = pagingFor(["a"]);

    expect(isDiscoverFeedExhausted(paging, END_OF_FEED_MISSES + 5)).toBe(false);
  });

  it("is the end when there are no queries at all", () => {
    expect(isDiscoverFeedExhausted(createDiscoveryPaging(), END_OF_FEED_MISSES)).toBe(true);
  });
});
