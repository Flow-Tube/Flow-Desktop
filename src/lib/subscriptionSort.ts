import type { SubscribedChannel } from "../store/useSubscriptionStore";
import type { VideoSummary } from "../types/video";

export type SubscriptionSortMode = "" | "name" | "recent";

/** The channels in the viewer's chosen order. The feed is newest first, so a channel's first video is its latest. */
export function sortSubscriptions<T extends Pick<SubscribedChannel, "id" | "name">>(
  channels: T[],
  mode: SubscriptionSortMode,
  feed: VideoSummary[],
): T[] {
  if (mode === "name") return [...channels].sort((a, b) => a.name.localeCompare(b.name));
  if (mode === "recent") {
    const latest = new Map<string, number>();
    feed.forEach((video, index) => {
      if (video.channelId && !latest.has(video.channelId)) latest.set(video.channelId, index);
    });
    const rank = (channel: T) => latest.get(channel.id) ?? Infinity;
    return [...channels].sort((a, b) => rank(a) - rank(b));
  }
  return channels;
}

export type SubscriptionKind = "video" | "music";

export function channelsOfKind<T extends Pick<SubscribedChannel, "isMusic">>(channels: T[], kind: SubscriptionKind): T[] {
  return channels.filter((channel) => Boolean(channel.isMusic) === (kind === "music"));
}
