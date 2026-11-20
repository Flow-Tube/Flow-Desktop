import { describe, expect, it } from "vitest";

import { playerWheelAction } from "./wheelAction";

describe("playerWheelAction", () => {
  it("reads the setting and scrolls the page by default", () => {
    expect(playerWheelAction("volume")).toBe("volume");
    expect(playerWheelAction("zoom")).toBe("zoom");
    expect(playerWheelAction(undefined)).toBe("scroll");
    expect(playerWheelAction("sideways")).toBe("scroll");
  });
});
