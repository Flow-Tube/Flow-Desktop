import { describe, expect, it } from "vitest";

import { pickCheckPositions, wordMatches } from "./recoveryCheck";

describe("pickCheckPositions", () => {
  it("returns two distinct, ordered positions inside the list", () => {
    for (const r of [0, 0.25, 0.5, 0.999]) {
      const [a, b] = pickCheckPositions(24, () => r);
      expect(a).toBeLessThan(b);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(24);
    }
  });

  it("never picks the same word twice, even at the end of the list", () => {
    const values = [0.999, 0.999];
    const [a, b] = pickCheckPositions(24, () => values.shift() ?? 0);
    expect(a).not.toBe(b);
  });
});

describe("wordMatches", () => {
  it("ignores case and surrounding spaces", () => {
    expect(wordMatches("abandon", "  Abandon ")).toBe(true);
    expect(wordMatches("abandon", "ability")).toBe(false);
  });
});
