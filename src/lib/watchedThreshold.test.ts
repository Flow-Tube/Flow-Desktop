import { describe, expect, it } from "vitest";
import { finishedShortIds, isWatched, watchedVideoIds } from "./watchedThreshold";
import type { WatchHistoryRecord } from "../types/db";

const record = (videoId: string, watched: number, total: number, isMusic = false): WatchHistoryRecord => ({
  videoId,
  title: videoId,
  watchDate: "2026-11-01T00:00:00Z",
  watchDurationSeconds: watched,
  totalDurationSeconds: total,
  isMusic,
});

describe("isWatched", () => {
  it("applies each threshold's share", () => {
    expect(isWatched(90, 100, "PERCENT_90")).toBe(true);
    expect(isWatched(90, 100, "PERCENT_95")).toBe(false);
    expect(isWatched(99, 100, "PERCENT_99")).toBe(true);
  });

  it("means the last minute of a long video and 90% of a short one under Almost finished", () => {
    expect(isWatched(3500, 3600, "ALMOST_FINISHED")).toBe(false);
    expect(isWatched(3545, 3600, "ALMOST_FINISHED")).toBe(true);
    expect(isWatched(10, 60, "ALMOST_FINISHED")).toBe(false);
    expect(isWatched(54, 60, "ALMOST_FINISHED")).toBe(true);
  });

  it("never counts a video with no progress or length", () => {
    expect(isWatched(0, 100, "PERCENT_90")).toBe(false);
    expect(isWatched(50, 0, "PERCENT_90")).toBe(false);
  });
});

describe("history filters", () => {
  it("leave songs out and keep the rest by their own rule", () => {
    const history = [record("video", 100, 100), record("song", 100, 100, true), record("half", 50, 100)];
    expect([...watchedVideoIds(history, "PERCENT_90")]).toEqual(["video"]);
    expect([...finishedShortIds(history)]).toEqual(["video"]);
  });
});
