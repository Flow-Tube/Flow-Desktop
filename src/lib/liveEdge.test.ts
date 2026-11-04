import { describe, expect, it } from "vitest";

import {
  clearLiveTiming,
  isAtLiveEdge,
  liveEdgePosition,
  liveStallRecoveryTarget,
  liveTimingFromPlaylist,
  liveWindow,
  readLiveTiming,
  secondsBehindLive,
  stampLiveTiming,
} from "./liveEdge";

const seekable = (ranges: Array<[number, number]>) =>
  ({
    length: ranges.length,
    start: (index: number) => ranges[index]![0],
    end: (index: number) => ranges[index]![1],
  }) as unknown as TimeRanges;

describe("liveWindow", () => {
  it("spans from the first range's start to the last range's end", () => {
    expect(liveWindow({ seekable: seekable([[10, 20], [30, 40]]) })).toEqual({ start: 10, end: 40 });
  });

  it("is empty before anything is seekable", () => {
    expect(liveWindow({ seekable: seekable([]) })).toEqual({ start: 0, end: 0 });
  });
});

describe("live edge", () => {
  it("counts the resting position as live at 5 second segments", () => {
    const timing = liveTimingFromPlaylist(15, 5);
    expect(isAtLiveEdge(985, 1000, timing)).toBe(true);
    expect(secondsBehindLive(985, 1000, timing)).toBe(0);
  });

  it("counts the resting position as live at 2 second segments", () => {
    const timing = liveTimingFromPlaylist(6, 2);
    expect(isAtLiveEdge(994, 1000, timing)).toBe(true);
    expect(isAtLiveEdge(980, 1000, timing)).toBe(false);
  });

  it("falls back to three segments before hls.js reports a target", () => {
    expect(liveTimingFromPlaylist(null, 5).holdBackSeconds).toBe(15);
  });

  it("measures how far behind from the resting position, not the window's end", () => {
    const timing = liveTimingFromPlaylist(15, 5);
    expect(secondsBehindLive(925, 1000, timing)).toBe(60);
  });

  it("goes to the resting position and stays inside the window", () => {
    const timing = liveTimingFromPlaylist(15, 5);
    expect(liveEdgePosition({ start: 0, end: 1000 }, timing)).toBe(985);
    expect(liveEdgePosition({ start: 995, end: 1000 }, timing)).toBe(995);
  });
});

describe("live timing on the video", () => {
  it("round-trips, and clears back to the defaults", () => {
    const video = document.createElement("video");
    const defaults = readLiveTiming(video);
    const timing = liveTimingFromPlaylist(15, 5);
    stampLiveTiming(video, timing);
    expect(readLiveTiming(video)).toEqual(timing);
    clearLiveTiming(video);
    expect(readLiveTiming(video)).toEqual(defaults);
  });
});

describe("liveStallRecoveryTarget", () => {
  const window = { start: 100, end: 1000 };

  it("catches up to live for a viewer who never seeked back", () => {
    expect(liveStallRecoveryTarget({ position: 900, window, syncPosition: 985, seekedBack: false })).toBe(985);
  });

  it("uses the window's end when hls.js has no sync position", () => {
    expect(liveStallRecoveryTarget({ position: 900, window, syncPosition: null, seekedBack: false })).toBe(996);
  });

  it("leaves a viewer who seeked back where they are", () => {
    expect(liveStallRecoveryTarget({ position: 300, window, syncPosition: 985, seekedBack: true })).toBeNull();
  });

  it("never jumps backward", () => {
    expect(liveStallRecoveryTarget({ position: 990, window, syncPosition: 985, seekedBack: false })).toBeNull();
  });

  it("moves back inside the window when playback fell off its start", () => {
    expect(liveStallRecoveryTarget({ position: 50, window, syncPosition: 985, seekedBack: true })).toBe(101);
  });
});
