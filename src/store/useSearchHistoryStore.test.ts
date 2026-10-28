import { beforeEach, describe, expect, it, vi } from "vitest";

const deepFlow = vi.hoisted(() => ({ record: true }));
vi.mock("../lib/deepFlow", () => ({ shouldRecordWatchHistory: () => deepFlow.record }));

import { SEARCH_HISTORY_LIMIT, useSearchHistoryStore } from "./useSearchHistoryStore";

const queries = () => useSearchHistoryStore.getState().entries.map((entry) => entry.query);

describe("search history", () => {
  beforeEach(() => {
    deepFlow.record = true;
    useSearchHistoryStore.getState().clear();
  });

  it("keeps the newest first and moves a repeated search to the top", () => {
    const { record } = useSearchHistoryStore.getState();
    record("lofi");
    record("the weeknd");
    record("  LOFI ");
    expect(queries()).toEqual(["LOFI", "the weeknd"]);
  });

  it("is kept across launches", () => {
    useSearchHistoryStore.getState().record("synthwave");
    expect(JSON.parse(localStorage.getItem("flow_search_history") ?? "[]")[0].query).toBe("synthwave");
  });

  it("caps its length", () => {
    for (let i = 0; i < SEARCH_HISTORY_LIMIT + 5; i += 1) useSearchHistoryStore.getState().record(`q${i}`);
    expect(queries()).toHaveLength(SEARCH_HISTORY_LIMIT);
    expect(queries()[0]).toBe(`q${SEARCH_HISTORY_LIMIT + 4}`);
  });

  it("records nothing while Deep Flow keeps history private", () => {
    deepFlow.record = false;
    useSearchHistoryStore.getState().record("secret");
    expect(queries()).toEqual([]);
  });

  it("removes one search, or all of them", () => {
    const { record, remove, clear } = useSearchHistoryStore.getState();
    record("a");
    record("b");
    remove("A");
    expect(queries()).toEqual(["b"]);
    clear();
    expect(queries()).toEqual([]);
  });
});
