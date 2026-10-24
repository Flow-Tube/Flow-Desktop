import { beforeEach, describe, expect, it } from "vitest";

import { migrateSavedMusicVolume, volumeGain, volumePosition } from "./volumeCurve";

describe("volumeCurve", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the ends and puts half way at about -12 dB", () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(1)).toBe(1);
    expect(20 * Math.log10(volumeGain(0.5))).toBeCloseTo(-12.04, 1);
    expect(volumeGain(volumePosition(0.3))).toBeCloseTo(0.3, 9);
  });

  it("converts an old saved gain once, so the level does not change", () => {
    localStorage.setItem("flow_music_player", JSON.stringify({ volume: 0.25, isMuted: false }));
    migrateSavedMusicVolume();
    expect(JSON.parse(localStorage.getItem("flow_music_player")!)).toEqual({ volume: 0.5, isMuted: false });

    migrateSavedMusicVolume();
    expect(JSON.parse(localStorage.getItem("flow_music_player")!).volume).toBe(0.5);
  });

  it("marks a fresh install as converted", () => {
    migrateSavedMusicVolume();
    localStorage.setItem("flow_music_player", JSON.stringify({ volume: 0.25 }));
    migrateSavedMusicVolume();
    expect(JSON.parse(localStorage.getItem("flow_music_player")!).volume).toBe(0.25);
  });
});
