import { describe, expect, it } from "vitest";
import { miniPlayerWidthPx } from "./miniPlayerSize";

describe("miniPlayerWidthPx", () => {
  it("maps each size and falls back to the size the player has always had", () => {
    expect(miniPlayerWidthPx("small")).toBe(320);
    expect(miniPlayerWidthPx("medium")).toBe(420);
    expect(miniPlayerWidthPx("large")).toBe(560);
    expect(miniPlayerWidthPx(undefined)).toBe(420);
    expect(miniPlayerWidthPx("huge")).toBe(420);
  });
});
