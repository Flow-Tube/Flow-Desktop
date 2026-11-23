import { useState } from "react";

/**
 * The widest `width` has been while mounted. A card that already shows a sharp thumbnail keeps it
 * when the window narrows, instead of loading a smaller file it would only blur.
 */
export function useWidestWidth(width: number): number {
  const [widest, setWidest] = useState(width);
  if (width > widest) setWidest(width);
  return Math.max(width, widest);
}
