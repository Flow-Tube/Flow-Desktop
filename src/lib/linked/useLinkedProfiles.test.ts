import { describe, expect, it } from "vitest";
import { unusedColor } from "./useLinkedProfiles";

describe("unusedColor", () => {
  it("picks the first color no profile uses", () => {
    expect(unusedColor([])).toBe("blue");
    expect(unusedColor(["blue", "teal"])).toBe("green");
  });

  it("falls back to blue once every color is taken", () => {
    expect(unusedColor(["blue", "teal", "green", "amber", "orange", "red", "pink", "purple"])).toBe("blue");
  });
});
