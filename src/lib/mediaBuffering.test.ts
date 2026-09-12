import { describe, expect, it } from "vitest";
import { hasMediaPlaybackProgressed, shouldEnterMediaBuffering } from "./mediaBuffering";

describe("shouldEnterMediaBuffering", () => {
  it("ignores a network stall while the video still has future data", () => {
    expect(shouldEnterMediaBuffering({
      signal: "stalled",
      paused: false,
      ended: false,
      seeking: false,
      readyState: 3,
    })).toBe(false);
  });

  it("ignores a late waiting event after playback has recovered", () => {
    expect(shouldEnterMediaBuffering({
      signal: "waiting",
      paused: false,
      ended: false,
      seeking: false,
      readyState: 4,
    })).toBe(false);
  });

  it("keeps real playback starvation visible", () => {
    expect(shouldEnterMediaBuffering({
      signal: "stalled",
      paused: false,
      ended: false,
      seeking: false,
      readyState: 2,
    })).toBe(true);
    expect(shouldEnterMediaBuffering({
      signal: "waiting",
      paused: false,
      ended: false,
      seeking: false,
      readyState: 2,
    })).toBe(true);
  });

  it("does not report buffering during pause, seek, or after playback ends", () => {
    const base = {
      signal: "waiting" as const,
      paused: false,
      ended: false,
      seeking: false,
      readyState: 2,
    };

    expect(shouldEnterMediaBuffering({ ...base, paused: true })).toBe(false);
    expect(shouldEnterMediaBuffering({ ...base, seeking: true })).toBe(false);
    expect(shouldEnterMediaBuffering({ ...base, ended: true })).toBe(false);
  });
});

describe("hasMediaPlaybackProgressed", () => {
  it("clears stale buffering once playback advances", () => {
    expect(hasMediaPlaybackProgressed(10, 10)).toBe(false);
    expect(hasMediaPlaybackProgressed(10, 10.02)).toBe(true);
  });
});
