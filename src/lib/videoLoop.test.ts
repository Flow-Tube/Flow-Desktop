import { describe, expect, it } from "vitest";
import { toggledLoop } from "./videoLoop";

describe("toggledLoop", () => {
  it("turns the session loop on from any other repeat mode", () => {
    expect(toggledLoop("none", false)).toBe("one");
    expect(toggledLoop("all", false)).toBe("one");
  });

  it("turns the session loop off", () => {
    expect(toggledLoop("one", false)).toBe("none");
    expect(toggledLoop("one", true)).toBe("none");
  });

  it("points to Settings when only Loop every video makes the video loop", () => {
    expect(toggledLoop("none", true)).toBe("settings");
    expect(toggledLoop("all", true)).toBe("settings");
  });
});
