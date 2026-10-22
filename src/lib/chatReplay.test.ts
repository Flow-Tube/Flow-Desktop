import { describe, expect, it } from "vitest";
import type { LiveChatMessage } from "../types/video";
import { isSeek, mergeReplay, needsMore, replayedBy } from "./chatReplay";

const message = (id: string, videoOffsetMs: number): LiveChatMessage => ({
  id,
  author: "Viewer",
  message: id,
  segments: [],
  messageType: "text",
  isOwner: false,
  isModerator: false,
  isVerified: false,
  isMember: false,
  videoOffsetMs,
});

describe("chat replay", () => {
  it("tells playback from a seek", () => {
    expect(isSeek(null, 10_000)).toBe(false);
    expect(isSeek(10_000, 11_000)).toBe(false);
    expect(isSeek(10_000, 60_000)).toBe(true);
    expect(isSeek(60_000, 10_000)).toBe(true);
    // Landing on the keyframe before the asked position is not a second seek.
    expect(isSeek(600_000, 597_000)).toBe(false);
  });

  it("merges pages by id in stream order", () => {
    const merged = mergeReplay([message("b", 2000)], [message("a", 1000), message("b", 2000), message("c", 3000)], 0);
    expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps the messages nearest the playhead when the buffer is full", () => {
    const old = Array.from({ length: 2000 }, (_, i) => message(`old${i}`, i));
    const merged = mergeReplay(old, [message("now", 900_000)], 900_000);
    expect(merged).toHaveLength(2000);
    expect(merged[merged.length - 1]?.id).toBe("now");
    expect(merged.some((m) => m.id === "old0")).toBe(false);
  });

  it("shows only what was sent by the playhead", () => {
    const buffer = [message("a", 1000), message("b", 5000), message("c", 9000)];
    expect(replayedBy(buffer, 5000).map((m) => m.id)).toEqual(["a", "b"]);
    expect(replayedBy(buffer, 0)).toEqual([]);
  });

  it("asks for more before the buffer runs out", () => {
    expect(needsMore([], 0)).toBe(true);
    expect(needsMore([message("a", 30_000)], 10_000)).toBe(false);
    expect(needsMore([message("a", 20_000)], 10_000)).toBe(true);
  });
});
