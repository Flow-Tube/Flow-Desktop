/** `items` in `orderedIds` order; ones not listed keep their order at the end. */
export const orderByIds = <T extends { id: string }>(
  items: T[],
  orderedIds: string[],
): T[] => {
  const rank = new Map<string, number>();
  orderedIds.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });
  const rankOf = (item: T) => rank.get(item.id) ?? Number.POSITIVE_INFINITY;
  return [...items].sort((a, b) => {
    const ra = rankOf(a);
    const rb = rankOf(b);
    return ra === rb ? 0 : ra < rb ? -1 : 1;
  });
};

/** Moves `movedId` right after `afterId`, or first when null; a missing id leaves `items` as they are. */
export const moveAfterId = <T extends { id: string }>(
  items: T[],
  movedId: string,
  afterId: string | null,
): T[] => {
  const moved = items.find((item) => item.id === movedId);
  if (!moved) return items;
  const rest = items.filter((item) => item.id !== movedId);
  const anchorIndex = afterId === null ? -1 : rest.findIndex((item) => item.id === afterId);
  if (afterId !== null && anchorIndex < 0) return items;
  const insertAt = anchorIndex + 1;
  const next = [...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)];
  return next.every((item, index) => item === items[index]) ? items : next;
};
