import type { LyricsListItem } from "../../../lib/lyrics/display/model";
import { INDICATOR_LEAD_OUT_MS, dotLook, type DotLook } from "../../../lib/lyrics/display/indicator";

export interface DotsHandle {
  dots: HTMLElement[];
  look: DotLook;
}

/**
 * Moves the dots of every mounted instrumental break: they fill with the break and breathe while
 * music plays. True while one still breathes, so the frame loop keeps going.
 */
export function stepDots(
  handles: Map<number, DotsHandle>,
  items: LyricsListItem[],
  shown: Set<number>,
  position: number,
  nowMs: number,
  animate: boolean,
): boolean {
  let breathing = false;
  if (handles.size === 0) return false;
  for (const [listIndex, handle] of handles) {
    const item = items[listIndex];
    // A hidden break keeps the look it faded out with.
    if (item?.kind !== "indicator" || !shown.has(listIndex)) continue;
    const breathes = animate;
    if (breathes) breathing = true;
    for (let i = 0; i < handle.dots.length; i++) {
      dotLook(i, position, item.gapStartMs, item.gapEndMs - INDICATOR_LEAD_OUT_MS, breathes ? nowMs : null, handle.look);
      const dot = handle.dots[i]!;
      dot.style.opacity = String(Math.round(handle.look.opacity * 1000) / 1000);
      dot.style.transform = `scale(${Math.round(handle.look.scale * 1000) / 1000})`;
    }
  }
  return breathing;
}
