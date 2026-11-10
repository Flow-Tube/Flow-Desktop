import { describe, expect, it } from "vitest";
import { neighbourLine } from "./useDiscoverChannels";

describe("neighbourLine", () => {
  it("names up to two channels, and none when it knows none", () => {
    expect(neighbourLine([])).toBeUndefined();
    expect(neighbourLine(["Alpha"])).toBe("A channel like Alpha");
    expect(neighbourLine(["Alpha", "Beta", "Gamma"])).toBe("A channel like Alpha and Beta");
  });
});
