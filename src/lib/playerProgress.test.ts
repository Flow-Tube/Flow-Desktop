import { describe, expect, it } from "vitest";
import {
  cssPercent,
  snapToBarPixel,
  progressTickBelongsTo,
  recoveryPosition,
  segmentFillPercent,
  shouldAnimateProgress,
  shouldPublishPlaybackTime,
} from "./playerProgress";

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

describe("shouldPublishPlaybackTime", () => {
  it("publishes only a loaded source that is not mid-swap", () => {
    expect(shouldPublishPlaybackTime(false, 4, true)).toBe(true);
    expect(shouldPublishPlaybackTime(false, 1, true)).toBe(true);
  });

  it("drops the reset to 0 a new source fires before it loads", () => {
    expect(shouldPublishPlaybackTime(false, 0, true)).toBe(false);
  });

  it("drops ticks while a swap waits to seek to its resume point", () => {
    expect(shouldPublishPlaybackTime(true, 4, true)).toBe(false);
  });

  it("drops ticks once the source is gone", () => {
    expect(shouldPublishPlaybackTime(false, 4, false)).toBe(false);
  });
});

describe("recoveryPosition", () => {
  it("keeps the handed position until the new source has played", () => {
    expect(recoveryPosition(0, 2400)).toBe(2400);
  });

  it("follows playback once it has", () => {
    expect(recoveryPosition(2460, null)).toBe(2460);
  });
});

describe("snapToBarPixel", () => {
  // A 10 minute video on a 900 px bar at 2x: 1800 positions, a third of a second each.
  const duration = 600;
  const steps = 1800;

  it("keeps one value for every frame that draws the same pixel", () => {
    const frames = Array.from({ length: 60 }, (_, frame) => 100 + frame / 60);
    const drawn = new Set(frames.map((time) => snapToBarPixel(time, duration, steps)));
    expect(drawn.size).toBeLessThanOrEqual(4);
  });

  it("stays within half a pixel of the real position", () => {
    for (const time of [0, 0.1, 17.3, 299.99, 600]) {
      expect(Math.abs(snapToBarPixel(time, duration, steps) - time)).toBeLessThanOrEqual(duration / steps / 2 + 1e-9);
    }
  });

  it("still moves every frame when the bar does, as on a short video", () => {
    const frames = Array.from({ length: 60 }, (_, frame) => frame / 60);
    expect(new Set(frames.map((time) => snapToBarPixel(time, 10, steps))).size).toBeGreaterThan(50);
  });

  it("leaves the time alone before the bar has a width or the video a length", () => {
    expect(snapToBarPixel(12.345, duration, 0)).toBe(12.345);
    expect(snapToBarPixel(12.345, 0, steps)).toBe(12.345);
  });
});

describe("cssPercent", () => {
  it("writes a percentage the way the browser reads it back", () => {
    expect(cssPercent(50)).toBe("50%");
    expect(cssPercent(100 / 3)).toBe("33.333%");
    expect(cssPercent(0)).toBe("0%");
  });
});
