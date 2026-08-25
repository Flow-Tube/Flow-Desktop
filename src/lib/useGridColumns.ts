import { useLayoutEffect, useMemo, useState, type CSSProperties, type RefObject } from 'react';
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

/**
 * How many cards actually share a row right now.
 *
 * `.flow-grid` fills with `auto-fill`, so the user's column preference is only
 * a ceiling — a narrow window sheds columns rather than shrinking cards. Only
 * the resolved track list knows the real count, so anything that has to line up
 * with a row boundary (a shelf slotted into the feed) has to measure it.
 *
 * Returns 0 until the first measurement lands.
 */
export function useResolvedGridColumns(
  ref: RefObject<HTMLElement | null>,
  style: CSSProperties,
): number {
  const [columns, setColumns] = useState(0);

  // Layout effect, not a passive one: the count decides where a row break goes,
  // and correcting that after paint would visibly reshuffle the feed.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => {
      // A laid-out grid always reports used track sizes in px; anything else
      // (`none`, an unresolved `repeat()`) means there is nothing to count yet.
      const tracks = getComputedStyle(element).gridTemplateColumns;
      const next = tracks.split(' ').filter((track) => track.endsWith('px')).length;
      setColumns((previous) => (previous === next ? previous : next));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
    // `style` carries the column preference, which changes the track count
    // without changing the element's size — the observer alone would miss it.
  }, [ref, style]);

  return columns;
}
