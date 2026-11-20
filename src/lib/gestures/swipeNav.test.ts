import { afterEach, describe, expect, it } from "vitest";

import { swipeHistoryDelta, swipeMayNavigate } from "./swipeNav";

function scroller(scrollLeft: number, dir: "ltr" | "rtl" = "ltr"): HTMLElement {
  const element = document.createElement("div");
  element.style.overflowX = "auto";
  element.style.direction = dir;
  Object.defineProperty(element, "scrollWidth", { value: 1000 });
  Object.defineProperty(element, "clientWidth", { value: 400 });
  element.scrollLeft = scrollLeft;
  document.body.append(element);
  return element;
}

describe("swipe navigation", () => {
  afterEach(() => document.body.replaceChildren());

  it("goes back when the fingers move toward the start of the line", () => {
    expect(swipeHistoryDelta(-150, false)).toBe(-1);
    expect(swipeHistoryDelta(150, false)).toBe(1);
    expect(swipeHistoryDelta(150, true)).toBe(-1);
  });

  it("lets a shelf that can still scroll take the swipe", () => {
    const shelf = scroller(300);
    expect(swipeMayNavigate(shelf, 40)).toBe(false);
    expect(swipeMayNavigate(shelf, -40)).toBe(false);
  });

  it("navigates once a shelf is at its end that way", () => {
    const atStart = scroller(0);
    expect(swipeMayNavigate(atStart, -40)).toBe(true);
    expect(swipeMayNavigate(atStart, 40)).toBe(false);
  });

  it("never navigates from the player or a slider", () => {
    const player = document.createElement("div");
    player.id = "flow-player-root";
    const inside = document.createElement("span");
    player.append(inside);
    document.body.append(player);
    expect(swipeMayNavigate(inside, -40)).toBe(false);
    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    document.body.append(slider);
    expect(swipeMayNavigate(slider, -40)).toBe(false);
  });
});
