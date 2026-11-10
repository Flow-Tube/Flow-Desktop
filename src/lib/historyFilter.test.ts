import { describe, expect, it } from "vitest";

import { effectiveHistoryFilter, filterHistory, historyYear, type HistoryView } from "./historyFilter";
import type { WatchHistoryRecord } from "../types/db";

const record = (videoId: string, watchDate: string, extra: Partial<WatchHistoryRecord> = {}): WatchHistoryRecord => ({
  videoId,
  title: videoId,
  channelName: "chan",
  watchDate,
  watchDurationSeconds: 1,
  ...extra,
});

const records = [
  record("video", "2026-06-15T12:00:00.000Z"),
  record("short", "2025-06-15T12:00:00.000Z", { isShort: true }),
  record("song", "2024-06-15T12:00:00.000Z", { isMusic: true, channelName: "Band" }),
];
const view = (changes: Partial<HistoryView>): HistoryView => ({ filter: "all", year: null, sort: "newest", query: "", shortsEnabled: true, ...changes });
const ids = (changes: Partial<HistoryView>) => filterHistory(records, view(changes)).map((item) => item.videoId);

describe("filterHistory", () => {
  it("shows no Shorts while Shorts are hidden, and the Shorts tab falls back to All", () => {
    expect(ids({ shortsEnabled: false })).toEqual(["video", "song"]);
    expect(effectiveHistoryFilter("shorts", false)).toBe("all");
    expect(effectiveHistoryFilter("shorts", true)).toBe("shorts");
    expect(effectiveHistoryFilter("music", false)).toBe("music");
  });

  it("keeps Shorts out of Videos and in their own tab", () => {
    expect(ids({ filter: "videos" })).toEqual(["video"]);
    expect(ids({ filter: "shorts" })).toEqual(["short"]);
    expect(ids({ filter: "music" })).toEqual(["song"]);
    expect(ids({ filter: "all" })).toEqual(["video", "short", "song"]);
  });

  it("narrows to a year", () => {
    expect(ids({ year: 2025 })).toEqual(["short"]);
  });

  it("sorts oldest first without touching the input", () => {
    expect(ids({ sort: "oldest" })).toEqual(["song", "short", "video"]);
    expect(records[0]?.videoId).toBe("video");
  });

  it("searches title and channel", () => {
    expect(ids({ query: " band " })).toEqual(["song"]);
  });
});

describe("historyYear", () => {
  it("is null for an unreadable date", () => {
    expect(historyYear("nonsense")).toBeNull();
  });
});
