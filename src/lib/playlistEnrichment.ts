import { formatYouTubeRelativeTime } from "./publishedDate";
import { formatCount } from "./utils";
import type { VideoMetadata, VideoSummary } from "../types/video";

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

/**
 * Fresh metadata wins, like Android's updateVideoMetadata; fields it lacks keep their stored
 * value. The upload time is stored exactly, so sorting by date never depends on the language a
 * date was written in, and the shown "3 years ago" is worked out from it.
 */
export function applyVideoMetadata(
  videos: VideoSummary[],
  refreshed: Map<string, VideoMetadata>,
  now = Date.now(),
): VideoSummary[] {
  let changed = false;

  const merged = videos.map((video) => {
    const metadata = refreshed.get(video.id);
    if (!metadata) return video;

    const views = metadata.viewCount;
    const publishedAt = metadata.publishedAtMs;
    const next: VideoSummary = {
      ...video,
      title: metadata.title || video.title,
      channelName: metadata.channelName || video.channelName,
      channelId: metadata.channelId ?? video.channelId ?? null,
      durationSeconds: metadata.durationSeconds || video.durationSeconds || null,
      // A stream that has ended has a length; one still on air keeps its live flag.
      isLive: metadata.isLive ? true : video.isLive && metadata.durationSeconds ? false : video.isLive ?? null,
      viewCount: views ?? video.viewCount ?? null,
      viewCountText: views != null ? `${formatCount(views)} views` : video.viewCountText ?? null,
      publishedAt: publishedAt ?? video.publishedAt ?? null,
      publishedText: publishedAt ? formatYouTubeRelativeTime(publishedAt, now) : video.publishedText ?? null,
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
