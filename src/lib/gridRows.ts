/**
 * Splits a flat feed into the rows a virtualized grid mounts one at a time.
 *
 * The row is the unit of virtualization because the cards themselves are laid
 * out by CSS grid: each row re-declares `.flow-grid`, and `auto-fill` resolves
 * the same track widths from the container width alone, so a row — including a
 * part-filled last one — matches the single grid it replaces.
 */
export interface GridCardRow<T> {
  kind: 'cards';
  key: string;
  items: T[];
  /** Index of this row's first item in the original list, for stable keys. */
  offset: number;
}

export interface GridSlotRow {
  kind: 'slot';
  key: string;
}

export type GridRow<T> = GridCardRow<T> | GridSlotRow;

export const GRID_SLOT_KEY = 'insert-slot';

/**
 * @param columns Resolved track count. Zero or less yields no rows, which the
 *   caller treats as "not measured yet" and renders un-virtualized instead.
 * @param withSlot Reserve a full-width row directly under the first row of
 *   cards — never after the first *card*, which would strand that row's
 *   remainder below the slot.
 */
export function chunkIntoRows<T extends { id: string }>(
  items: T[],
  columns: number,
  withSlot: boolean,
): GridRow<T>[] {
  if (columns <= 0) return [];

  const rows: GridRow<T>[] = [];
  for (let offset = 0; offset < items.length; offset += columns) {
    const chunk = items.slice(offset, offset + columns);
    rows.push({
      kind: 'cards',
      key: `row-${chunk[0]?.id ?? offset}-${offset}`,
      items: chunk,
      offset,
    });
    if (withSlot && offset === 0) {
      rows.push({ kind: 'slot', key: GRID_SLOT_KEY });
    }
  }
  return rows;
}
