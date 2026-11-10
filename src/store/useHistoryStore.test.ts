import { beforeEach, describe, expect, it, vi } from "vitest";

const restoreWatchRecord = vi.fn();
const getWatchHistory = vi.fn();
const deleteShortWatchRecords = vi.fn();
vi.mock("../lib/api/db", () => ({
  restoreWatchRecord: (record: unknown) => restoreWatchRecord(record),
  deleteShortWatchRecords: () => deleteShortWatchRecords(),
  clearWatchHistory: vi.fn(),
  deleteWatchRecord: vi.fn(),
  getWatchHistory: (limit: number, offset: number) => getWatchHistory(limit, offset),
}));

import { useHistoryStore } from "./useHistoryStore";

const record = (videoId: string, watchDate: string, isShort = false) => ({ videoId, title: videoId, watchDate, watchDurationSeconds: 1, isShort });
const newest = record("newest", "2026-03-01T00:00:00.000Z");
const middle = record("middle", "2026-02-01T00:00:00.000Z");
const oldest = record("oldest", "2026-01-01T00:00:00.000Z", true);
const ids = () => useHistoryStore.getState().records.map((item) => item.videoId);

describe("useHistoryStore", () => {
  beforeEach(() => {
    restoreWatchRecord.mockReset().mockResolvedValue(undefined);
    deleteShortWatchRecords.mockReset().mockResolvedValue(undefined);
    useHistoryStore.setState({ records: [newest, oldest], offset: 2, hasMore: false });
  });

  it("restores a row where its date belongs", async () => {
    await useHistoryStore.getState().restore(middle);
    expect(restoreWatchRecord).toHaveBeenCalledWith(middle);
    expect(ids()).toEqual(["newest", "middle", "oldest"]);
    expect(useHistoryStore.getState().offset).toBe(3);
  });

  it("leaves a row older than every loaded page to its page", async () => {
    useHistoryStore.setState({ records: [newest], offset: 1, hasMore: true });
    await useHistoryStore.getState().restore(oldest);
    expect(ids()).toEqual(["newest"]);
    expect(useHistoryStore.getState().offset).toBe(1);
  });

  it("does not list a row twice", async () => {
    await useHistoryStore.getState().restore(newest);
    expect(ids()).toEqual(["newest", "oldest"]);
  });

  it("drops loaded Shorts and keeps paging straight", async () => {
    await useHistoryStore.getState().removeShorts();
    expect(ids()).toEqual(["newest"]);
    expect(useHistoryStore.getState().offset).toBe(1);
  });

  it("changes nothing when the backend refuses", async () => {
    deleteShortWatchRecords.mockRejectedValue(new Error("db"));
    await expect(useHistoryStore.getState().removeShorts()).rejects.toThrow("db");
    expect(ids()).toEqual(["newest", "oldest"]);
  });

  it("picks up what was watched since the last visit when forced to reload", async () => {
    getWatchHistory.mockReset().mockResolvedValue([newest]);
    useHistoryStore.setState({ records: [], offset: 0, loaded: false });
    await useHistoryStore.getState().load();
    getWatchHistory.mockResolvedValue([record("watched-since", "2026-04-01T00:00:00.000Z"), newest]);

    await useHistoryStore.getState().load();
    expect(ids()).toEqual(["newest"]);

    await useHistoryStore.getState().load(true);
    expect(ids()).toEqual(["watched-since", "newest"]);
  });
});
