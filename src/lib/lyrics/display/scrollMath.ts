import type { LyricsListItem } from "./model";

/** Port of Android's LyricsScrollMath.kt. Row heights are known up front here, from the text layout. */

export interface LyricsRowMetrics {
  lineHeightPx: number;
  indicatorHeightPx: number;
  constraintLineHeightPx: number;
  gapPx: number;
}

/** Background vocals and instrumental breaks hug the row above them. */
const hugsPrevious = (item: LyricsListItem): boolean =>
  (item.kind === "line" && !!item.entry.isBackground) || item.kind === "indicator";

const fallbackHeight = (item: LyricsListItem, lineHeightPx: number, metrics: LyricsRowMetrics): number =>
  item.kind === "indicator" ? metrics.indicatorHeightPx : lineHeightPx;

const heightOf = (items: LyricsListItem[], heights: ArrayLike<number | undefined>, i: number, lineHeightPx: number, metrics: LyricsRowMetrics) =>
  heights[i] ?? fallbackHeight(items[i]!, lineHeightPx, metrics);

/** Each row's top, relative to the active row's top, in px. */
export function lyricsRowOffsets(
  items: LyricsListItem[],
  heights: ArrayLike<number | undefined>,
  activeIndex: number,
  metrics: LyricsRowMetrics,
): Map<number, number> {
  const map = new Map<number, number>();
  if (activeIndex === -1 || items.length === 0) return map;
  map.set(activeIndex, 0);
  let y = 0;
  for (let i = activeIndex - 1; i >= 0; i--) {
    y -= heightOf(items, heights, i, metrics.lineHeightPx, metrics) + (hugsPrevious(items[i]!) ? 0 : metrics.gapPx);
    map.set(i, y);
  }
  y = 0;
  for (let i = activeIndex; i < items.length - 1; i++) {
    y += heightOf(items, heights, i, metrics.lineHeightPx, metrics) + (hugsPrevious(items[i + 1]!) ? 0 : metrics.gapPx);
    map.set(i + 1, y);
  }
  return map;
}

/** How far the user may drag the list up: the last row stays `bottomMarginPx` from the top edge. */
export function lyricsMinScrollOffset(
  items: LyricsListItem[],
  heights: ArrayLike<number | undefined>,
  activeIndex: number,
  anchorY: number,
  bottomMarginPx: number,
  metrics: LyricsRowMetrics,
): number {
  if (items.length === 0 || activeIndex === -1) return 0;
  let totalBelow = 0;
  for (let i = activeIndex; i < items.length - 1; i++) {
    totalBelow +=
      heightOf(items, heights, i, metrics.constraintLineHeightPx, metrics) + (hugsPrevious(items[i + 1]!) ? 0 : metrics.gapPx);
  }
  const lastHeight = heightOf(items, heights, items.length - 1, metrics.constraintLineHeightPx, metrics);
  return bottomMarginPx - anchorY - totalBelow - lastHeight;
}

/** How far the user may drag the list down: the first row stays `topMarginPx` above the bottom. */
export function lyricsMaxScrollOffset(
  items: LyricsListItem[],
  heights: ArrayLike<number | undefined>,
  activeIndex: number,
  anchorY: number,
  viewportHeightPx: number,
  topMarginPx: number,
  metrics: LyricsRowMetrics,
): number {
  if (items.length === 0 || activeIndex === -1) return 0;
  let totalAbove = 0;
  for (let i = 0; i < activeIndex; i++) {
    totalAbove += heightOf(items, heights, i, metrics.constraintLineHeightPx, metrics) + (hugsPrevious(items[i]!) ? 0 : metrics.gapPx);
  }
  return viewportHeightPx - topMarginPx - anchorY + totalAbove;
}
