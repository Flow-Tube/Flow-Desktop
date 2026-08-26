import { describe, expect, it } from "vitest";

import { chunkIntoRows, type GridCardRow, type GridRow } from "./gridRows";

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `v${i}` }));
const cardRows = <T,>(rows: GridRow<T>[]) =>
  rows.filter((row): row is GridCardRow<T> => row.kind === 'cards');
const flatten = <T,>(rows: GridRow<T>[]) => cardRows(rows).flatMap((row) => row.items);

describe("chunkIntoRows", () => {
  /*
    The invariant that matters most: virtualization must not change *what* is in
    the feed, only how much of it is mounted. A dropped or duplicated item here
    would look like a recommendation-engine bug.
  */
  it("preserves every item, once, in order", () => {
    const source = items(23);
    const rows = chunkIntoRows(source, 4, false);

    expect(flatten(rows).map((v) => v.id)).toEqual(source.map((v) => v.id));
  });

  it("fills every row but the last", () => {
    const rows = cardRows(chunkIntoRows(items(23), 4, false));

    expect(rows.map((row) => row.items.length)).toEqual([4, 4, 4, 4, 4, 3]);
  });

  it("reports each row's offset into the original list", () => {
    const rows = cardRows(chunkIntoRows(items(10), 3, false));

    expect(rows.map((row) => row.offset)).toEqual([0, 3, 6, 9]);
  });

  it("gives rows distinct keys", () => {
    const rows = chunkIntoRows(items(20), 4, true);
    const keys = rows.map((row) => row.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  /*
    The slot belongs under the whole first row. Placing it after the first *card*
    would push that row's remaining cards below it.
  */
  it("puts the slot after the first full row, not the first card", () => {
    const rows = chunkIntoRows(items(12), 4, true);

    expect(rows[0]?.kind).toBe('cards');
    expect(rows[1]?.kind).toBe('slot');
    expect((rows[0] as GridCardRow<{ id: string }>).items).toHaveLength(4);
  });

  it("emits exactly one slot", () => {
    const rows = chunkIntoRows(items(40), 4, true);

    expect(rows.filter((row) => row.kind === 'slot')).toHaveLength(1);
  });

  it("omits the slot when there is nothing to slot in", () => {
    const rows = chunkIntoRows(items(12), 4, false);

    expect(rows.some((row) => row.kind === 'slot')).toBe(false);
  });

  it("emits no orphan slot for an empty feed", () => {
    expect(chunkIntoRows([], 4, true)).toEqual([]);
  });

  it("handles a feed shorter than one row", () => {
    const rows = cardRows(chunkIntoRows(items(2), 4, false));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.items).toHaveLength(2);
  });

  /*
    Zero means the grid has not been measured yet. Returning no rows is what
    makes the caller fall back to the plain grid rather than render a blank feed.
  */
  it("yields nothing until the column count is known", () => {
    expect(chunkIntoRows(items(10), 0, true)).toEqual([]);
    expect(chunkIntoRows(items(10), -1, true)).toEqual([]);
  });

  it("degrades to one card per row at a single column", () => {
    const rows = cardRows(chunkIntoRows(items(3), 1, false));

    expect(rows.map((row) => row.items.length)).toEqual([1, 1, 1]);
  });
});
