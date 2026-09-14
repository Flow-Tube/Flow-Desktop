import { describe, expect, it } from "vitest";
import {
  hasMediaPlaybackProgressed,
  shouldEnterMediaBuffering,
  type MediaBufferingSnapshot,
} from "./mediaBuffering";

const starved: MediaBufferingSnapshot = {
  paused: false,
  ended: false,
  readyState: 2,
};

const decide = (overrides: Partial<MediaBufferingSnapshot> = {}) =>
  shouldEnterMediaBuffering({ ...starved, ...overrides });

describe("shouldEnterMediaBuffering", () => {
  it("shows the spinner while the next frame is not decodable", () => {
    expect(decide()).toBe(true);
    expect(decide({ readyState: 0 })).toBe(true);
    expect(decide({ readyState: 1 })).toBe(true);
  });

  it("ignores a hint fired while the element still has future data", () => {
    // The stale spinner this replaced: `stalled` on an idle fetch, or a
    // `waiting` delivered after playback recovered, latched the spinner on a
    // video that never stopped — so no `playing` event ever cleared it.
    expect(decide({ readyState: 3 })).toBe(false);
    expect(decide({ readyState: 4 })).toBe(false);
  });

  it("stays quiet while paused or after playback ends", () => {
    expect(decide({ paused: true })).toBe(false);
    expect(decide({ ended: true })).toBe(false);
  });
});

describe("hasMediaPlaybackProgressed", () => {
  it("reports recovery once the clock passes where the stall began", () => {
    expect(hasMediaPlaybackProgressed(10, 10.02)).toBe(true);
  });

  it("treats a clock that has not moved as still stalled", () => {
    expect(hasMediaPlaybackProgressed(10, 10)).toBe(false);
    expect(hasMediaPlaybackProgressed(10, 10.005)).toBe(false);
    expect(hasMediaPlaybackProgressed(10, 9.5)).toBe(false);
  });

  it("reports nothing when either clock is unusable", () => {
    // A non-finite bound would otherwise latch the spinner permanently.
    expect(hasMediaPlaybackProgressed(null, 10)).toBe(false);
    expect(hasMediaPlaybackProgressed(Number.NaN, 10)).toBe(false);
    expect(hasMediaPlaybackProgressed(10, Number.NaN)).toBe(false);
    expect(hasMediaPlaybackProgressed(10, Number.POSITIVE_INFINITY)).toBe(false);
  });
});
