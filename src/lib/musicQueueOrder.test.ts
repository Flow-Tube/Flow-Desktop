import { describe, expect, it } from "vitest";

import type { SongItem } from "../types/music";
import { upcomingIndex, type QueuePosition } from "./musicQueueOrder";

const queue = ["a", "b", "c", "d"].map((id) => ({ id }) as SongItem);
const at = (currentIndex: number, extra: Partial<QueuePosition> = {}): QueuePosition => ({
  queue,
  currentIndex,
  repeatMode: "none",
  ...extra,
});

describe("upcomingIndex", () => {
  it("plays the following track, and nothing after the last", () => {
    expect(upcomingIndex(at(1))).toBe(2);
    expect(upcomingIndex(at(3))).toBe(-1);
  });

  it("wraps with repeat-all and has no next track with repeat-one", () => {
    expect(upcomingIndex(at(3, { repeatMode: "all" }))).toBe(0);
    expect(upcomingIndex(at(1, { repeatMode: "one" }))).toBe(-1);
  });

  it("does not warm a single song a second time under repeat-all", () => {
    expect(upcomingIndex({ queue: queue.slice(0, 1), currentIndex: 0, repeatMode: "all" })).toBe(-1);
  });

  it("has nothing to play from an empty queue", () => {
    expect(upcomingIndex({ ...at(0), queue: [] })).toBe(-1);
  });
});
