import type { SubscribedChannel } from "../store/useSubscriptionStore";
import type { VideoSummary } from "../types/video";

export type SubscriptionSortMode = "" | "name" | "recent";

/** Channel ids by their latest upload, newest first. The feed is newest first, so a channel's first video is its latest. */
export function channelsByNewestUpload(feed: VideoSummary[]): string[] {
  const seen = new Set<string>();
  for (const video of feed) {
    if (video.channelId) seen.add(video.channelId);
  }
  return [...seen];
}

/** The channels in the viewer's chosen order. `newestFirst` comes from {@link channelsByNewestUpload}. */
export function sortSubscriptions<T extends Pick<SubscribedChannel, "id" | "name">>(
  channels: T[],
  mode: SubscriptionSortMode,
  newestFirst: string[],
): T[] {
  if (mode === "name") return [...channels].sort((a, b) => a.name.localeCompare(b.name));
  if (mode === "recent") {
    const latest = new Map(newestFirst.map((id, index) => [id, index]));
    const rank = (channel: T) => latest.get(channel.id) ?? Infinity;
    return [...channels].sort((a, b) => rank(a) - rank(b));
  }
  return channels;
}

export type SubscriptionKind = "video" | "music";

export function channelsOfKind<T extends Pick<SubscribedChannel, "isMusic">>(channels: T[], kind: SubscriptionKind): T[] {
  return channels.filter((channel) => Boolean(channel.isMusic) === (kind === "music"));
}
