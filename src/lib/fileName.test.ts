import { describe, expect, it } from "vitest";

import { safeFileName } from "./fileName";

describe("safeFileName", () => {
  it("keeps letters of every script and replaces only what file systems refuse", () => {
    expect(safeFileName("DIVINE - तू छोड़ा", "x")).toBe("DIVINE - तू छोड़ा");
    expect(safeFileName("夜に駆ける", "x")).toBe("夜に駆ける");
    expect(safeFileName('AC/DC: "Live"?', "x")).toBe("AC_DC_ _Live__");
    expect(safeFileName("  ", "flow-lyrics")).toBe("flow-lyrics");
  });
});
