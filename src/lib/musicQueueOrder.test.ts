import { beforeEach, describe, expect, it } from "vitest";

import type { SongItem } from "../types/music";
import { resetQueueOrder, upcomingIndex, type QueuePosition } from "./musicQueueOrder";

const queue = ["a", "b", "c", "d"].map((id) => ({ id }) as SongItem);
const at = (currentIndex: number, extra: Partial<QueuePosition> = {}): QueuePosition => ({
  queue,
  currentIndex,
  isShuffle: false,
  repeatMode: "none",
  ...extra,
});

beforeEach(() => resetQueueOrder());

describe("upcomingIndex", () => {
  it("plays the following track, and nothing after the last", () => {
    expect(upcomingIndex(at(1))).toBe(2);
    expect(upcomingIndex(at(3))).toBe(-1);
  });

  it("wraps with repeat-all and has no next track with repeat-one", () => {
    expect(upcomingIndex(at(3, { repeatMode: "all" }))).toBe(0);
    expect(upcomingIndex(at(1, { repeatMode: "one" }))).toBe(-1);
  });

  it("keeps one shuffle pick per track so the warmed track is the one that plays", () => {
    const first = upcomingIndex(at(0, { isShuffle: true }));
    expect(first).not.toBe(0);
    for (let i = 0; i < 20; i++) expect(upcomingIndex(at(0, { isShuffle: true }))).toBe(first);
    const fromNext = upcomingIndex(at(first, { isShuffle: true }));
    expect(fromNext).not.toBe(first);
  });

  it("has nothing to play from an empty queue", () => {
    expect(upcomingIndex({ ...at(0), queue: [] })).toBe(-1);
  });
});
