import { describe, expect, it, vi } from "vitest";

const audio = { time: 0, speed: 1 };
vi.mock("../../audio/musicAudioEngine", () => ({
  musicAudioEngine: { getCurrentTime: () => audio.time, getDuration: () => 200, getSpeed: () => audio.speed },
}));

import { LyricsClock } from "./clock";

describe("LyricsClock", () => {
  it("carries the position forward at the playback speed", () => {
    audio.time = 10;
    audio.speed = 0.5;
    const clock = new LyricsClock();
    expect(clock.read(1000, true)).toBe(10_000);
    expect(clock.read(1400, true)).toBeCloseTo(10_200, 6);
  });

  it("never moves back while playing when the element reports a little behind", () => {
    audio.time = 10;
    audio.speed = 1;
    const clock = new LyricsClock();
    clock.read(0, true);
    const before = clock.read(400, true);
    audio.time = 10.2;
    const after = clock.read(416, true);
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("takes a jump of half a second or more as a seek", () => {
    audio.time = 10;
    audio.speed = 1;
    const clock = new LyricsClock();
    clock.read(0, true);
    clock.read(16, true);
    audio.time = 40;
    expect(clock.read(32, true)).toBe(40_000);
  });

  it("shows the element's own position while paused", () => {
    audio.time = 12.5;
    const clock = new LyricsClock();
    expect(clock.read(5000, false)).toBe(12_500);
  });
});
