import { describe, expect, it } from "vitest";
import { nextAutoAdvanceVideo } from "./autoAdvance";
import type { VideoSummary } from "../types/video";

const video = (id: string): VideoSummary => ({ id, title: id, channelName: "c" });
const on = { autoplay: true, queueAutoplay: true };
const base = { queue: [video("a"), video("b")], currentIndex: 0, repeatMode: "none" as const, autoplayCandidates: [video("r")] };

describe("nextAutoAdvanceVideo", () => {
  it("plays the queue with related autoplay off, the request in issue 344", () => {
    expect(nextAutoAdvanceVideo(base, { autoplay: false, queueAutoplay: true })?.id).toBe("b");
  });

  it("plays no suggestion when the queue ends with related autoplay off", () => {
    expect(nextAutoAdvanceVideo({ ...base, currentIndex: 1 }, { autoplay: false, queueAutoplay: true })).toBeNull();
  });

  it("stops inside a queue with queue autoplay off, even with related autoplay on", () => {
    expect(nextAutoAdvanceVideo(base, { autoplay: true, queueAutoplay: false })).toBeNull();
  });

  it("offers a suggestion past the end of the queue, skipping what is already queued", () => {
    const state = { ...base, currentIndex: 1, autoplayCandidates: [video("a"), video("r")] };
    expect(nextAutoAdvanceVideo(state, on)?.id).toBe("r");
    expect(nextAutoAdvanceVideo(state, { autoplay: true, queueAutoplay: false })?.id).toBe("r");
  });

  it("wraps with repeat all under the queue switch", () => {
    const state = { ...base, currentIndex: 1, repeatMode: "all" as const };
    expect(nextAutoAdvanceVideo(state, on)?.id).toBe("a");
    expect(nextAutoAdvanceVideo(state, { autoplay: true, queueAutoplay: false })).toBeNull();
  });

  it("has nothing to play without a queue", () => {
    expect(nextAutoAdvanceVideo({ ...base, queue: [], currentIndex: -1 }, on)).toBeNull();
  });
});
