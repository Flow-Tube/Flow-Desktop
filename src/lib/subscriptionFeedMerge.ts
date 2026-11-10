import { parseRelativeToTimestamp } from "./publishedDate";
import type { VideoSummary } from "../types/video";

/**
 * A refresh of some channels within the whole feed. Their stored uploads go; what the refresh found
 * and the feed did not have is new, so it leads, and what it had stays where it was.
 */
export function mergeScopedFeed(previous: VideoSummary[], scope: string[], fresh: VideoSummary[]): VideoSummary[] {
  const channels = new Set(scope);
  const known = new Set(previous.map((video) => video.id));
  const freshById = new Map(fresh.map((video) => [video.id, video]));
  const newlyFound = fresh.filter((video) => !known.has(video.id));
  const kept = previous.flatMap((video) => {
    const updated = freshById.get(video.id);
    if (updated) return [updated];
    return video.channelId && channels.has(video.channelId) ? [] : [video];
  });
  return [...newlyFound, ...kept];
}

const publishedAt = (video: VideoSummary, now: number) =>
  video.publishedText ? parseRelativeToTimestamp(video.publishedText, now) : null;

/** Collaborations slotted into the feed by age; one the feed already has stays as it is. */
export function mergeCollaborations(
  feed: VideoSummary[],
  collaborations: VideoSummary[],
  now = Date.now(),
): VideoSummary[] {
  const known = new Set(feed.map((video) => video.id));
  const merged = [...feed];
  for (const video of collaborations) {
    if (known.has(video.id)) continue;
    const at = publishedAt(video, now);
    const place = at === null ? -1 : merged.findIndex((other) => (publishedAt(other, now) ?? Infinity) < at);
    if (place < 0) merged.push(video);
    else merged.splice(place, 0, video);
  }
  return merged;
}

/** A video of this channel, whether it uploaded it or made it with the uploader. */
export function isVideoOfChannel(video: VideoSummary, channelId: string): boolean {
  return video.channelId === channelId || Boolean(video.collaborators?.some((c) => c.channelId === channelId));
}
