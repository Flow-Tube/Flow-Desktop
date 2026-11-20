export type CardDirection = "left" | "right" | "up" | "down";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const centre = (box: Box) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });

/**
 * The card to move to from `from`: the nearest one whose centre lies that way, preferring cards in
 * the same row or column. Works across a grid, a shelf and the next shelf down alike.
 */
export function nextCardIndex(from: Box, cards: readonly Box[], direction: CardDirection): number | null {
  const start = centre(from);
  let best: { index: number; score: number } | null = null;
  cards.forEach((card, index) => {
    const { x, y } = centre(card);
    const dx = x - start.x;
    const dy = y - start.y;
    const along = direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
    const across = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    // Half a pixel of slack, so the card itself and cards beside it never count.
    if (along <= 0.5) return;
    const score = along + across * 2;
    if (!best || score < best.score) best = { index, score };
  });
  return best === null ? null : (best as { index: number }).index;
}

const ARROWS: Record<string, CardDirection> = {
  arrowleft: "left",
  arrowright: "right",
  arrowup: "up",
  arrowdown: "down",
};

export const directionForKey = (key: string): CardDirection | null => ARROWS[key.toLowerCase()] ?? null;

/** Marks the element of a card that takes keyboard focus. */
export const CARD_FOCUS_ATTR = "data-card-focus";
