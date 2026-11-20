import { describe, expect, it } from "vitest";

import { nextCardIndex } from "./cardNavigation";

const card = (column: number, row: number) => ({ left: column * 100, top: row * 80, width: 90, height: 70 });
// A 3 by 2 grid, then a shelf below.
const cards = [card(0, 0), card(1, 0), card(2, 0), card(0, 1), card(1, 1), card(2, 1), card(0, 3), card(1, 3)];

describe("nextCardIndex", () => {
  it("moves along a row and down a column", () => {
    expect(nextCardIndex(cards[0]!, cards, "right")).toBe(1);
    expect(nextCardIndex(cards[1]!, cards, "down")).toBe(4);
    expect(nextCardIndex(cards[4]!, cards, "left")).toBe(3);
    expect(nextCardIndex(cards[4]!, cards, "up")).toBe(1);
  });

  it("goes down to the next shelf", () => {
    expect(nextCardIndex(cards[5]!, cards, "down")).toBe(7);
  });

  it("stops at the edge", () => {
    expect(nextCardIndex(cards[2]!, cards, "right")).toBeNull();
    expect(nextCardIndex(cards[0]!, cards, "up")).toBeNull();
  });
});
