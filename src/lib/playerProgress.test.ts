import { describe, expect, it } from "vitest";
import { progressTickBelongsTo, segmentFillPercent, shouldAnimateProgress } from "./playerProgress";

describe("shouldAnimateProgress", () => {
  it("animates only a playing bar someone can see, or a scrub", () => {
    expect(shouldAnimateProgress(true, true, false)).toBe(true);
    expect(shouldAnimateProgress(true, false, false)).toBe(false);
    expect(shouldAnimateProgress(false, true, false)).toBe(false);
    expect(shouldAnimateProgress(false, false, true)).toBe(true);
  });
});

describe("segmentFillPercent", () => {
  it("fills segments before, inside and after the playhead", () => {
    expect(segmentFillPercent(5, 10, 20)).toBe(0);
    expect(segmentFillPercent(15, 10, 20)).toBe(50);
    expect(segmentFillPercent(25, 10, 20)).toBe(100);
  });

  it("treats an empty segment as unfilled until the playhead passes it", () => {
    expect(segmentFillPercent(10, 10, 10)).toBe(0);
    expect(segmentFillPercent(11, 10, 10)).toBe(100);
  });
});

describe("progressTickBelongsTo", () => {
  it("counts ticks only from the stream of the video now playing", () => {
    expect(progressTickBelongsTo("new", "new")).toBe(true);
    expect(progressTickBelongsTo("new", "old")).toBe(false);
    expect(progressTickBelongsTo("new", null)).toBe(false);
    expect(progressTickBelongsTo(null, null)).toBe(false);
  });
});
