import { useEffect } from "react";

import { CARD_FOCUS_ATTR, nextCardIndex } from "./cardNavigation";
import { IS_MACOS_RUNTIME } from "./platform";
import { CARD_COMMANDS } from "./shortcuts/cardCommands";
import { findShortcut } from "./shortcuts/command";

/**
 * Arrow keys on a focused card move to the nearest card that way, across grids and shelves. They are
 * taken on the way down, so a playing video doesn't also seek or change its volume.
 */
export function useCardArrowKeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const from = event.target;
      if (!(from instanceof HTMLElement) || !from.hasAttribute(CARD_FOCUS_ATTR)) return;
      const direction = findShortcut(CARD_COMMANDS, event, IS_MACOS_RUNTIME)?.action;
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      const cards = [...document.querySelectorAll<HTMLElement>(`[${CARD_FOCUS_ATTR}]`)].filter(
        (card) => card !== from && card.getClientRects().length > 0,
      );
      const index = nextCardIndex(from.getBoundingClientRect(), cards.map((card) => card.getBoundingClientRect()), direction);
      const next = index === null ? null : cards[index];
      if (!next) return;
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
