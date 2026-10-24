import { describe, expect, it } from "vitest";
import { heatmapPath, pickStoryboardLevel, storyboardFrameAt } from "./seekPreview";
import type { StoryboardLevel } from "../types/video";

const level = (width: number, columns = 5, rows = 5): StoryboardLevel => ({
  width, height: Math.round((width * 9) / 16), count: 61, columns, rows, intervalMs: 2000,
  urlTemplate: `https://i.ytimg.com/sb/x/L/M$M.jpg?sigh=s`,
});

describe("seek previews", () => {
  it("uses the level nearest the drawn size", () => {
    expect(pickStoryboardLevel([level(48), level(80), level(160)])?.width).toBe(160);
    expect(pickStoryboardLevel([])).toBeNull();
  });

  it("finds the sheet and tile for a time", () => {
    const frame = storyboardFrameAt(level(160), 61);
    // Frame 30 is the sixth frame of sheet 1: column 0, row 1.
    expect(frame.url).toBe("https://i.ytimg.com/sb/x/L/M1.jpg?sigh=s");
    expect([frame.x, frame.y]).toEqual([0, 90]);
    expect([frame.sheetWidth, frame.sheetHeight]).toEqual([800, 450]);
  });

  it("stops at the last frame", () => {
    expect(storyboardFrameAt(level(160), 9999).url).toContain("M2.jpg");
  });

  it("draws the heatmap as an area along the bottom", () => {
    const path = heatmapPath([{ startMs: 0, durationMs: 1000, intensity: 1 }, { startMs: 1000, durationMs: 1000, intensity: 0 }], 2);
    expect(path).toBe("M0,100 L250.0,0.0 L750.0,100.0 L1000,100 Z");
    expect(heatmapPath([], 10)).toBeNull();
  });
});
