import { describe, expect, it } from "vitest";
import { cleanChannelName, isStatsString } from "./videoStats";

describe("videoStats", () => {
  it("identifies view and stream counts", () => {
    expect(isStatsString("105K views")).toBe(true);
    expect(isStatsString("4.9M views")).toBe(true);
    expect(isStatsString("1.2M views")).toBe(true);
    expect(isStatsString("643K views")).toBe(true);
    expect(isStatsString("96K views")).toBe(true);
    expect(isStatsString("1,423 views")).toBe(true);
    expect(isStatsString("105K")).toBe(true);
    expect(isStatsString("334K")).toBe(true);
    expect(isStatsString("13K watching")).toBe(true);
    expect(isStatsString("No views")).toBe(true);
    expect(isStatsString("20 hours ago")).toBe(true);
    expect(isStatsString("3 days ago")).toBe(true);
  });

  it("does not mistake actual creator or channel names for stats", () => {
    expect(isStatsString("Maddock Films")).toBe(false);
    expect(isStatsString("TechTrends")).toBe(false);
    expect(isStatsString("Filmi Indian")).toBe(false);
    expect(isStatsString("Views from the 6")).toBe(false);
    expect(isStatsString("Channel 4")).toBe(false);
    expect(isStatsString("Studio 54")).toBe(false);
  });

  it("cleans channel names properly", () => {
    expect(cleanChannelName("105K views")).toBe("");
    expect(cleanChannelName("4.9M views")).toBe("");
    expect(cleanChannelName("Maddock Films")).toBe("Maddock Films");
  });
});
