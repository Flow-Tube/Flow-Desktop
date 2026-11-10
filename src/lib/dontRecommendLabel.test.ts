import { describe, expect, it } from "vitest";

import { dontRecommendLabel } from "./dontRecommendLabel";

describe("dontRecommendLabel", () => {
  it("names the channel", () => {
    expect(dontRecommendLabel("Some Channel")).toBe("Don't recommend Some Channel");
  });

  it("keeps a name with replacement patterns as written", () => {
    expect(dontRecommendLabel("Cash $& Co")).toBe("Don't recommend Cash $& Co");
  });

  it("falls back when the name is missing", () => {
    expect(dontRecommendLabel("  ")).toBe("Don't recommend this channel");
    expect(dontRecommendLabel(undefined)).toBe("Don't recommend this channel");
  });
});
