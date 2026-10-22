import type { RelatedContentItem, VideoSummary } from "../types/video";

const identity = (item: RelatedContentItem) =>
  `${item.itemType}:${item.videoId ?? ""}:${item.playlistId ?? item.id}`;

/** `existing` followed by the items of `more` it does not already hold. */
export function appendRelated(existing: RelatedContentItem[], more: RelatedContentItem[]): RelatedContentItem[] {
  const seen = new Set(existing.map(identity));
  return [...existing, ...more.filter((item) => !seen.has(identity(item)))];
}

export function relatedItemToVideoSummary(item: RelatedContentItem): VideoSummary {
  return {
    id: item.videoId || item.id,
    title: item.title,
    channelName: item.channelName,
    channelId: item.channelId,
    thumbnailUrl: item.thumbnailUrl,
    durationSeconds: item.durationSeconds,
    publishedText: item.publishedText,
    viewCountText: item.viewCountText,
    isLive: item.isLive,
    channelAvatarUrl: item.channelAvatarUrl,
    isUpcoming: item.isUpcoming,
    isVerified: item.isVerified,
    isMembersOnly: item.isMembersOnly,
    badges: item.badges,
    collaborators: item.collaborators,
  };
}

/**
 * What autoplay picks from, in order: the related videos with the one YouTube itself would
 * play next moved to the front. With no related videos left (the lane is off, empty or all
 * blocked), YouTube's pick alone, as a stub the player fills in like a cold open.
 */
export function autoplayCandidates(related: RelatedContentItem[], autoplayVideoId: string | null | undefined): VideoSummary[] {
  const videos = related.filter((item) => !item.itemType || item.itemType === "video").map(relatedItemToVideoSummary);
  if (!autoplayVideoId) return videos;
  const index = videos.findIndex((video) => video.id === autoplayVideoId);
  const pick = videos[index];
  if (index > 0 && pick) return [pick, ...videos.slice(0, index), ...videos.slice(index + 1)];
  if (videos.length === 0) return [{ id: autoplayVideoId, title: "", channelName: "" }];
  return videos;
}
