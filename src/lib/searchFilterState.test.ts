import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEARCH_FILTER_STATE,
  availableWith,
  isDefaultFilterState,
  sanitizeFilterState,
} from "./searchFilterState";

describe("search filter state", () => {
  it("knows the default apart from any narrowing", () => {
    expect(isDefaultFilterState(DEFAULT_SEARCH_FILTER_STATE)).toBe(true);
    expect(isDefaultFilterState({ ...DEFAULT_SEARCH_FILTER_STATE, category: "videos" })).toBe(false);
    expect(
      isDefaultFilterState({
        ...DEFAULT_SEARCH_FILTER_STATE,
        filters: { ...DEFAULT_SEARCH_FILTER_STATE.filters, watchState: "unwatched" },
      }),
    ).toBe(false);
  });

  it("fills in what an older stored entry lacks", () => {
    const state = sanitizeFilterState({ category: "videos", filters: { duration: "long" } });
    expect(state?.category).toBe("videos");
    expect(state?.filters.duration).toBe("long");
    expect(state?.filters.watchState).toBe("any");
    expect(state?.filters.features).toEqual([]);
    expect(sanitizeFilterState(null)).toBeUndefined();
  });

  it("drops a Shorts search only while Shorts are hidden", () => {
    const shorts = { ...DEFAULT_SEARCH_FILTER_STATE, category: "shorts" as const };
    expect(availableWith(shorts, false).category).toBe("all");
    expect(availableWith(shorts, true).category).toBe("shorts");
  });
});
