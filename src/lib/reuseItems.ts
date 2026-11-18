const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/**
 * `next` with every item that is unchanged since `previous` swapped for the object `previous`
 * holds, and `previous` itself when nothing changed at all. A list parsed from IPC is all new
 * objects even when it repeats what is on screen, which makes every memoized row render again.
 */
export function reuseById<T extends { id: string }>(previous: readonly T[], next: T[]): T[] {
  const known = new Map(previous.map((item) => [item.id, item]));
  let unchanged = previous.length === next.length;
  const items = next.map((item, index) => {
    const old = known.get(item.id);
    const kept = old && sameJson(old, item) ? old : item;
    if (kept !== previous[index]) unchanged = false;
    return kept;
  });
  return unchanged ? (previous as T[]) : items;
}

/** `next`, or `previous` when both hold the same data. */
export function reuseIfSame<T>(previous: T, next: T): T {
  return sameJson(previous, next) ? previous : next;
}
