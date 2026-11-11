import { describe, expect, it } from "vitest";
import { ambientShown } from "./ambientShown";

const base = { enabled: true, glow: false, theater: true, videoFit: "fit" as const, blocked: false };

describe("ambientShown", () => {
  it("keeps the glow around the player in every resize mode", () => {
    for (const videoFit of ["fit", "fill", "zoom"] as const) {
      expect(ambientShown({ ...base, glow: true, theater: false, videoFit })).toBe(true);
    }
  });

  it("fills theater's side bars only in Fit, which is the only mode that leaves them", () => {
    expect(ambientShown(base)).toBe(true);
    expect(ambientShown({ ...base, videoFit: "fill" })).toBe(false);
    expect(ambientShown({ ...base, videoFit: "zoom" })).toBe(false);
    expect(ambientShown({ ...base, theater: false })).toBe(false);
  });

  it("stays off when ambient mode is off or the player has no page around it", () => {
    expect(ambientShown({ ...base, glow: true, enabled: false })).toBe(false);
    expect(ambientShown({ ...base, glow: true, blocked: true })).toBe(false);
  });
});
