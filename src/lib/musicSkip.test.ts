import { describe, expect, it } from "vitest";
import { MAX_UNPLAYABLE_SKIPS, shouldSkipUnplayable } from "./musicSkip";

describe("shouldSkipUnplayable", () => {
  it("skips a removed or region-locked track while there is a next one", () => {
    expect(shouldSkipUnplayable("contentNotAvailable", 0, true)).toBe(true);
    expect(shouldSkipUnplayable("geographicRestriction", 1, true)).toBe(true);
    expect(shouldSkipUnplayable("contentNotAvailable", 0, false)).toBe(false);
  });

  it("stops after a streak and on viewer-level refusals", () => {
    expect(shouldSkipUnplayable("contentNotAvailable", MAX_UNPLAYABLE_SKIPS, true)).toBe(false);
    for (const kind of ["botCheckRequired", "networkWall", "rateLimited", "network", "extractor"]) {
      expect(shouldSkipUnplayable(kind, 0, true)).toBe(false);
    }
  });
});
