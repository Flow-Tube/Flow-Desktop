// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { SCROLL_ANCHOR_ATTRIBUTE, anchorCorrection, findScrollAnchor } from "./useScrollAnchor";

/** A column of 100 px cards starting at `offset` in the viewport. */
function cards(keys: string[], offset: number): HTMLElement[] {
  return keys.map((key, index) => {
    const element = document.createElement("div");
    element.setAttribute(SCROLL_ANCHOR_ATTRIBUTE, key);
    const top = offset + index * 100;
    element.getBoundingClientRect = () => ({ top, bottom: top + 100 }) as DOMRect;
    return element;
  });
}

describe("findScrollAnchor", () => {
  it("picks the first card still showing below the top edge", () => {
    expect(findScrollAnchor(cards(["a", "b", "c", "d"], -250), 0, 250)).toEqual({ key: "c", top: -50, scrollTop: 250 });
  });

  it("finds nothing when every card is above the top edge", () => {
    expect(findScrollAnchor(cards(["a", "b"], -500), 0, 500)).toBeNull();
  });
});

describe("anchorCorrection", () => {
  it("scrolls by however far the card moved", () => {
    const root = document.createElement("div");
    root.append(...cards(["new1", "new2", "a", "b"], -50));
    // "a" was at -50; two new cards above now put it at 150.
    expect(anchorCorrection({ key: "a", top: -50, scrollTop: 250 }, root)).toBe(200);
  });

  it("leaves the page alone at the top, so new videos show there", () => {
    const root = document.createElement("div");
    root.append(...cards(["new1", "a"], 0));
    expect(anchorCorrection({ key: "a", top: 0, scrollTop: 0 }, root)).toBe(0);
  });

  it("leaves the page alone when the card is gone", () => {
    const root = document.createElement("div");
    root.append(...cards(["b"], 0));
    expect(anchorCorrection({ key: "a", top: 0, scrollTop: 300 }, root)).toBe(0);
  });
});
