import { useMemo, type CSSProperties } from 'react';
import { SETTINGS } from './settings/schema';
import { useNumberPref } from './usePreference';

export const GRID_COLUMN_OPTIONS = [2, 3, 4, 5, 6, 7, 8] as const;
export const GRID_COLUMNS_DEFAULT = 4;

/**
 * Square/portrait cards (shorts, albums, artists, channels) carry no meta column,
 * so they fit more per row than a 16:9 video card at the same readable width.
 */
const DENSE_COLUMN_OFFSET = 2;

export type GridDensity = 'video' | 'dense';

/** Below this a card's title/avatar row stops being legible, so a column is dropped instead. */
const CARD_MIN_REM: Record<GridDensity, number> = {
  video: 13,
  dense: 8,
};

interface GridStyleOptions {
  density?: GridDensity;
  /** Column gap in rem. `.flow-grid` owns column-gap, so pair this with a `gap-y-*` class only. */
  gapRem?: number;
}

/**
 * CSS variables for `.flow-grid` / `.flow-grid-card`, derived from the user's
 * column preference. The count is a ceiling — the class steps down on narrow
 * windows rather than shrinking cards past `CARD_MIN_REM`.
 */
export function useGridStyle({ density = 'video', gapRem = 1 }: GridStyleOptions = {}): CSSProperties {
  const [columns] = useNumberPref(SETTINGS.GRID_COLUMNS, GRID_COLUMNS_DEFAULT);

  return useMemo(() => {
    const target = density === 'dense' ? columns + DENSE_COLUMN_OFFSET : columns;
    return {
      '--flow-grid-columns': String(target),
      '--flow-grid-card-min': `${CARD_MIN_REM[density]}rem`,
      '--flow-grid-gap': `${gapRem}rem`,
    } as CSSProperties;
  }, [columns, density, gapRem]);
}
