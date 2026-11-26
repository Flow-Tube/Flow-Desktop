import type { SubscribedChannel } from "../store/useSubscriptionStore";
import type { VideoSummary } from "../types/video";
import { reorderSubset } from "./subscriptionPins";

export type SubscriptionSortMode = "" | "name" | "recent" | "watched" | "manual";

/** What the sorts that don't follow the channels' own fields read. */
export interface SubscriptionOrderSources {
  /** Channel ids by latest upload, from {@link channelsByNewestUpload}. */
  newestFirst?: string[];
  /** The order set by dragging in Manage. */
  manualOrder?: string[];
  /** Videos watched per channel id. */
  watchCounts?: Record<string, number>;
}

/** Channel ids by their latest upload, newest first. The feed is newest first, so a channel's first video is its latest. */
export function channelsByNewestUpload(feed: VideoSummary[]): string[] {
  const seen = new Set<string>();
  for (const video of feed) {
    if (video.channelId) seen.add(video.channelId);
  }
  return [...seen];
}

const byRank = <T extends { id: string }>(channels: T[], ids: string[]): T[] => {
  const rank = new Map(ids.map((id, index) => [id, index]));
  return [...channels].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
};

/**
 * The channels in the viewer's chosen order. Channels the manual order doesn't name yet, such as
 * ones followed since, come after it in the order they were followed.
 */
export function sortSubscriptions<T extends Pick<SubscribedChannel, "id" | "name">>(
  channels: T[],
  mode: SubscriptionSortMode,
  sources: SubscriptionOrderSources = {},
): T[] {
  if (mode === "name") return [...channels].sort((a, b) => a.name.localeCompare(b.name));
  if (mode === "recent") return byRank(channels, sources.newestFirst ?? []);
  if (mode === "manual") return byRank(channels, sources.manualOrder ?? []);
  if (mode === "watched") {
    const counts = sources.watchCounts ?? {};
    return [...channels].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0));
  }
  return channels;
}

/**
 * The stored manual order after a list showing `shown` (in their new order) was reordered. Every
 * followed channel gets a place, so ones the order didn't name yet stay where they showed.
 */
export function reorderedManualOrder(channels: Array<{ id: string }>, stored: string[], shown: string[]): string[] {
  const everyChannel = byRank(channels, stored).map((channel) => channel.id);
  return reorderSubset(everyChannel, shown);
}

export type SubscriptionKind = "video" | "music";

export function channelsOfKind<T extends Pick<SubscribedChannel, "isMusic">>(channels: T[], kind: SubscriptionKind): T[] {
  return channels.filter((channel) => Boolean(channel.isMusic) === (kind === "music"));
}
