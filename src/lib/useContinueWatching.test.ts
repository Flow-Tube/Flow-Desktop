import { describe, expect, it } from "vitest";
import { buildContinueWatching } from "./useContinueWatching";
import type { WatchHistoryRecord } from "../types/db";

const record = (videoId: string, watched: number, total: number, isMusic = false): WatchHistoryRecord => ({
  videoId,
  title: videoId,
  watchDate: "2026-10-21T10:00:00Z",
  watchDurationSeconds: watched,
  totalDurationSeconds: total,
  isMusic,
});

describe("buildContinueWatching", () => {
  it("keeps started videos and leaves out finished, hidden and music ones", () => {
    const shelf = buildContinueWatching(
      [record("a", 100, 600), record("b", 590, 600), record("c", 100, 600), record("d", 100, 600, true)],
      new Set(["c"]),
    );
    expect(shelf.map((video) => video.id)).toEqual(["a"]);
    expect(shelf[0]?.viewCountText).toBe("17% watched");
  });

  it("leaves out a Short swiped away halfway", () => {
    expect(buildContinueWatching([record("short", 15, 30)], new Set())).toEqual([]);
  });
});
