import type { VideoSummary } from "../types/video";

const fold = (text: string): string =>
  text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** The videos whose title and channel hold every word of `query`, whatever their accents or case. */
export function filterVideosBySearch(videos: VideoSummary[], query: string): VideoSummary[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return videos;
  return videos.filter((video) => {
    const text = fold(`${video.title} ${video.channelName}`);
    return words.every((word) => text.includes(word));
  });
}
