import { beforeEach, describe, expect, it, vi } from "vitest";

const deepFlow = vi.hoisted(() => ({ record: true }));
vi.mock("../lib/deepFlow", () => ({ deepFlowAllowsHistory: () => deepFlow.record }));

import { SETTINGS } from "../lib/settings/schema";
import { useAppSettingsStore } from "./useAppSettingsStore";
import { SEARCH_HISTORY_DEFAULT_LIMIT as SEARCH_HISTORY_LIMIT, useSearchHistoryStore, visibleSearchEntries } from "./useSearchHistoryStore";

const queries = () => useSearchHistoryStore.getState().entries.map((entry) => entry.query);

describe("search history", () => {
  beforeEach(() => {
    deepFlow.record = true;
    useAppSettingsStore.setState({ values: {} });
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

  it("saves nothing while saving searches is off", () => {
    useAppSettingsStore.setState({ values: { [SETTINGS.SEARCH_HISTORY_ENABLED]: "false" } });
    useSearchHistoryStore.getState().record("secret");
    expect(queries()).toEqual([]);
  });

  it("keeps saving searches while watch history alone is paused", () => {
    useAppSettingsStore.setState({ values: { [SETTINGS.PAUSE_WATCH_HISTORY]: "true" } });
    useSearchHistoryStore.getState().record("kept");
    expect(queries()).toEqual(["kept"]);
  });

  it("follows Max history size when recording, and forgets on trimming", () => {
    useAppSettingsStore.setState({ values: { [SETTINGS.SEARCH_HISTORY_MAX_SIZE]: "2" } });
    for (const query of ["a", "b", "c"]) useSearchHistoryStore.getState().record(query);
    expect(queries()).toEqual(["c", "b"]);
    useSearchHistoryStore.getState().trimTo(1);
    expect(queries()).toEqual(["c"]);
  });
});

describe("visibleSearchEntries", () => {
  const now = Date.UTC(2026, 5, 1);
  const day = 86_400_000;
  const entries = [{ query: "new", at: now - day }, { query: "old", at: now - 40 * day }];
  const shown = (values: Record<string, string>) => visibleSearchEntries(entries, values, now).map((entry) => entry.query);

  it("shows everything by default", () => {
    expect(shown({})).toEqual(["new", "old"]);
  });

  it("shows nothing while saving is off", () => {
    expect(shown({ [SETTINGS.SEARCH_HISTORY_ENABLED]: "false" })).toEqual([]);
  });

  it("hides what's past its age only with auto-delete on", () => {
    expect(shown({ [SETTINGS.SEARCH_HISTORY_RETENTION_DAYS]: "30" })).toEqual(["new", "old"]);
    expect(shown({ [SETTINGS.SEARCH_HISTORY_RETENTION_DAYS]: "30", [SETTINGS.AUTO_DELETE_SEARCH_HISTORY]: "true" })).toEqual(["new"]);
  });

  it("caps at the size", () => {
    expect(shown({ [SETTINGS.SEARCH_HISTORY_MAX_SIZE]: "1" })).toEqual(["new"]);
  });
});
