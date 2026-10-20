import { describe, expect, it } from "vitest";
import { advanceProgress } from "./useWatchSession";

describe("advanceProgress", () => {
  it("counts small forward steps as playback", () => {
    let progress = advanceProgress(null, "a", 0, 100);
    progress = advanceProgress(progress, "a", 0.25, 100);
    progress = advanceProgress(progress, "a", 0.5, 100);
    expect(progress.unreportedPlayed).toBeCloseTo(0.5);
    expect(progress.position).toBe(0.5);
  });

  it("does not count a seek as playback", () => {
    let progress = advanceProgress(null, "a", 1, 100);
    progress = advanceProgress(progress, "a", 90, 100);
    progress = advanceProgress(progress, "a", 30, 100);
    expect(progress.unreportedPlayed).toBe(0);
    expect(progress.position).toBe(30);
  });

  it("starts over for another video, so no progress crosses videos", () => {
    let progress = advanceProgress(null, "a", 1, 100);
    progress = advanceProgress(progress, "a", 2, 100);
    progress = advanceProgress(progress, "b", 0.2, 50);
    expect(progress).toEqual({ videoId: "b", position: 0.2, duration: 50, unreportedPlayed: 0, reportedAt: 0 });
  });

  it("keeps the known length while the media reports none", () => {
    let progress = advanceProgress(null, "a", 1, 100);
    progress = advanceProgress(progress, "a", 2, 0);
    expect(progress.duration).toBe(100);
  });
});
