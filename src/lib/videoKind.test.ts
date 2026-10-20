import { describe, expect, it } from "vitest";
import { isKnownShort } from "./videoKind";

describe("isKnownShort", () => {
  it("needs a known length of a minute or less", () => {
    expect(isKnownShort(45)).toBe(true);
    expect(isKnownShort(60)).toBe(true);
    expect(isKnownShort(61)).toBe(false);
  });

  it("never guesses from a missing length", () => {
    expect(isKnownShort(null)).toBe(false);
    expect(isKnownShort(undefined)).toBe(false);
    expect(isKnownShort(0)).toBe(false);
  });
});
