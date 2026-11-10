import { describe, expect, it } from "vitest";
import { isFinishedPosition, resumeStartSeconds } from "./resumePolicy";

describe("resume policy", () => {
  it("resumes from half a second on", () => {
    expect(resumeStartSeconds(0.5, 300)).toBe(0);
    expect(resumeStartSeconds(0.6, 300)).toBe(0.6);
    expect(resumeStartSeconds(4, 300)).toBe(4);
    expect(resumeStartSeconds(Number.NaN, 300)).toBe(0);
  });

  it("restarts within the last 1.5 seconds or past 98%", () => {
    expect(resumeStartSeconds(288, 300)).toBe(288);
    expect(resumeStartSeconds(294, 300)).toBe(0);
    expect(resumeStartSeconds(58.4, 60)).toBe(58.4);
    expect(resumeStartSeconds(58.5, 60)).toBe(0);
    expect(resumeStartSeconds(3600 * 0.98, 3600)).toBe(0);
    expect(resumeStartSeconds(3500, 3600)).toBe(3500);
  });

  it("uses the 4 hour limit when the duration is unknown", () => {
    expect(resumeStartSeconds(3600, 0)).toBe(3600);
    expect(resumeStartSeconds(5 * 3600, 0)).toBe(0);
    expect(isFinishedPosition(0, 0)).toBe(false);
  });
});
