import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CARD_FOCUS_ATTR } from "./cardNavigation";
import { useCardArrowKeys } from "./useCardArrowKeys";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  useCardArrowKeys();
  return null;
}

function cardAt(left: number, top: number): HTMLElement {
  const card = document.createElement("div");
  card.tabIndex = 0;
  card.setAttribute(CARD_FOCUS_ATTR, "");
  const rect = { left, top, width: 90, height: 70, right: left + 90, bottom: top + 70, x: left, y: top, toJSON: () => ({}) };
  card.getBoundingClientRect = () => rect as DOMRect;
  card.getClientRects = () => [rect] as unknown as DOMRectList;
  card.scrollIntoView = vi.fn();
  document.body.append(card);
  return card;
}

const press = (key: string, target: EventTarget) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

describe("useCardArrowKeys", () => {
  let root: Root;
  beforeEach(() => {
    root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it("moves focus to the card that way and keeps the key from the player", () => {
    const first = cardAt(0, 0);
    const second = cardAt(100, 0);
    const below = cardAt(0, 100);
    const player = vi.fn();
    window.addEventListener("keydown", player);
    first.focus();
    expect(press("ArrowRight", first).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(second);
    press("ArrowDown", second);
    expect(document.activeElement).toBe(below);
    expect(player).not.toHaveBeenCalled();
    window.removeEventListener("keydown", player);
  });

  it("leaves arrows alone when no card has focus", () => {
    cardAt(0, 0);
    expect(press("ArrowRight", document.body).defaultPrevented).toBe(false);
  });
});
