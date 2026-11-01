import { describe, expect, it } from "vitest";
import { getString, type StringKey } from "./index";
import strings from "./strings.json";

describe("getString", () => {
  it("fills several values in order", () => {
    expect(getString("linked_dashboard_used", "1 MB", "2 MB")).toBe("1 MB of 2 MB used");
  });

  it("only meets placeholders it can fill", () => {
    const unfilled = Object.keys(strings).filter((key) =>
      /%(?:\d+\$)?[a-z]/.test(getString(key as StringKey, "x", "x", "x")),
    );
    expect(unfilled).toEqual([]);
  });
});
