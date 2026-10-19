import type { VideoDetails, VideoSummary } from "../types/video";

// Mirrors Flow-Android's PlaylistDetailViewModel stub enrichment.
export const ENRICHMENT_TRACK_LIMIT = 50;
export const ENRICHMENT_CHUNK_SIZE = 5;
export const ENRICHMENT_CHUNK_DELAY_MS = 300;

/** Missing a duration, view count or publish date. A live stream has no duration to fetch. */
export const needsEnrichment = (video: VideoSummary): boolean =>
  !(video.isLive || (video.durationSeconds ?? 0) > 0) ||
  !video.viewCountText ||
  !video.publishedText;

const asNullable = <T>(value: T | undefined) => value ?? null;

/** Fresh details win, like Android's updateVideoMetadata; fields they lack keep their stored value. */
export function applyVideoDetails(
  videos: VideoSummary[],
  refreshed: Map<string, VideoDetails>,
): VideoSummary[] {
  let changed = false;

  const merged = videos.map((video) => {
    const details = refreshed.get(video.id);
    if (!details) return video;

    const next: VideoSummary = {
      ...video,
      title: details.title || video.title,
      channelName: details.channelName || video.channelName,
      channelId: details.channelId ?? video.channelId ?? null,
      thumbnailUrl: details.thumbnailUrl ?? video.thumbnailUrl ?? null,
      durationSeconds: details.durationSeconds || video.durationSeconds || null,
      isLive: details.isLive ?? video.isLive ?? null,
      viewCountText: details.viewCountText || video.viewCountText || null,
      publishedText: details.publishedText || video.publishedText || null,
    };

    const differs = (Object.keys(next) as Array<keyof VideoSummary>).some(
      (key) => asNullable(next[key]) !== asNullable(video[key]),
    );
    if (!differs) return video;
    changed = true;
    return next;
  });

  return changed ? merged : videos;
}
