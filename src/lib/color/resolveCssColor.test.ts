import { describe, expect, it } from "vitest";

import { parseComputedColor } from "./resolveCssColor";

describe("parseComputedColor", () => {
  it("reads the forms a browser computes", () => {
    expect(parseComputedColor("rgb(255, 78, 69)")).toEqual({ r: 255, g: 78, b: 69 });
    expect(parseComputedColor("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30 });
    expect(parseComputedColor("color(srgb 1 0.5 0)")).toEqual({ r: 255, g: 128, b: 0 });
    expect(parseComputedColor("transparent")).toBeNull();
  });
});
