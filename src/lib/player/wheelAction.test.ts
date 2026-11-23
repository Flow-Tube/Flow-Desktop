import { describe, expect, it } from "vitest";

import { ctrlWheelAction, playerWheelAction } from "./wheelAction";

describe("playerWheelAction", () => {
  it("reads the setting and scrolls the page by default", () => {
    expect(playerWheelAction("volume")).toBe("volume");
    expect(playerWheelAction("zoom")).toBe("zoom");
    expect(playerWheelAction(undefined)).toBe("scroll");
    expect(playerWheelAction("sideways")).toBe("scroll");
  });
});

describe("ctrlWheelAction", () => {
  it("zooms, or changes the volume when the plain wheel already zooms", () => {
    expect(ctrlWheelAction("scroll")).toBe("zoom");
    expect(ctrlWheelAction("volume")).toBe("zoom");
    expect(ctrlWheelAction("zoom")).toBe("volume");
  });
});
