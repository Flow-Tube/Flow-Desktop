import { describe, expect, it } from "vitest";
import { homeReselectAction } from "./homeReselect";

describe("homeReselectAction", () => {
  it("scrolls up first, whatever the setting", () => {
    expect(homeReselectAction(300, true)).toBe("scroll");
    expect(homeReselectAction(300, false)).toBe("scroll");
  });

  it("refreshes at the top only when the switch is on", () => {
    expect(homeReselectAction(0, true)).toBe("refresh");
    expect(homeReselectAction(0, false)).toBe("none");
  });
});
