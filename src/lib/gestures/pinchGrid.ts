import { GRID_COLUMN_OPTIONS } from "../useGridColumns";

/** How far a pinch must go before the feed changes by one column. */
const PINCH_STEP = 1.3;

/**
 * Adds a pinch step to the running scale and says what to do: spreading the fingers makes the
 * thumbnails bigger (one column fewer), pinching them together makes them smaller (one more).
 */
export function pinchColumns(columns: number, scale: number): { columns: number; scale: number } {
  const min = GRID_COLUMN_OPTIONS[0];
  const max = GRID_COLUMN_OPTIONS[GRID_COLUMN_OPTIONS.length - 1]!;
  if (scale >= PINCH_STEP) return { columns: Math.max(min, columns - 1), scale: 1 };
  if (scale <= 1 / PINCH_STEP) return { columns: Math.min(max, columns + 1), scale: 1 };
  return { columns, scale };
}
