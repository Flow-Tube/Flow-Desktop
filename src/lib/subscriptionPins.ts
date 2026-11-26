/**
 * Pinned channels, ported from Flow for Android (#1776, SubscriptionPins.kt). Pins are channel ids
 * kept in one comma-separated setting, in pin order, which syncs with Android as
 * `subscriptions_pinned_channels`. The manual order of all channels uses the same format.
 */

/** Channel ids from a stored comma-separated list: trimmed, without blanks or repeats. */
export function parseChannelIds(stored: string | null | undefined): string[] {
  if (!stored) return [];
  return [...new Set(stored.split(",").map((id) => id.trim()).filter(Boolean))];
}

export function channelIdsToStorage(ids: string[]): string {
  return ids.join(",");
}

/** `pins` with `channelId` added at the end, or removed when it was already pinned. */
export function togglePinned(pins: string[], channelId: string): string[] {
  return pins.includes(channelId) ? pins.filter((id) => id !== channelId) : [...pins, channelId];
}

/**
 * `all` with the ids in `shown` put in that order, in the slots they held; ids not in `shown`
 * stay put. Reordering the pins of one tab, or the channels a search shows, leaves the rest alone.
 */
export function reorderSubset(all: string[], shown: string[]): string[] {
  const shownSet = new Set(shown);
  const next = shown.filter((id) => all.includes(id))[Symbol.iterator]();
  return all.map((id) => {
    if (!shownSet.has(id)) return id;
    const step = next.next();
    return step.done ? id : step.value;
  });
}

/**
 * The pinned channels first, in pin order, then the rest in the order given. A pin for a channel
 * no longer followed is skipped.
 */
export function pinnedFirst<T extends { id: string }>(sorted: T[], pins: string[]): { channels: T[]; pinnedCount: number } {
  const byId = new Map(sorted.map((channel) => [channel.id, channel]));
  const pinned = pins.map((id) => byId.get(id)).filter((channel): channel is T => !!channel);
  const pinnedIds = new Set(pinned.map((channel) => channel.id));
  return { channels: [...pinned, ...sorted.filter((channel) => !pinnedIds.has(channel.id))], pinnedCount: pinned.length };
}
