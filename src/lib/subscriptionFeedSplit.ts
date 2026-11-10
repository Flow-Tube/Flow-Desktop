import type { ShortVideoSummary, VideoSummary } from "../types/video";

export interface SubscriptionFeedSections {
  showShorts: boolean;
  showLive: boolean;
  showVideos: boolean;
  excludedShortChannels: ReadonlySet<string>;
  finishedShorts: ReadonlySet<string>;
}

const isLiveVideo = (video: VideoSummary) => {
  const published = video.publishedText?.toLowerCase() ?? "";
  const views = video.viewCountText?.toLowerCase() ?? "";
  return Boolean(video.isLive) || published.includes("live") || views.includes("watching");
};

const asShort = (video: VideoSummary): ShortVideoSummary => ({
  type: "short",
  id: video.id,
  title: video.title,
  channelName: video.channelName,
  channelId: video.channelId ?? null,
  thumbnailUrl: video.thumbnailUrl ?? null,
  channelAvatarUrl: video.channelAvatarUrl ?? null,
  viewCountText: video.viewCountText ?? null,
  publishedText: video.publishedText ?? null,
});

/** The Subscriptions feed as its Shorts shelf and its grid, each holding only what will really show. */
export function splitSubscriptionFeed(
  videos: VideoSummary[],
  { showShorts, showLive, showVideos, excludedShortChannels, finishedShorts }: SubscriptionFeedSections,
): { shortsForShelf: ShortVideoSummary[]; regularVideos: VideoSummary[] } {
  const shortsForShelf: ShortVideoSummary[] = [];
  const regularVideos: VideoSummary[] = [];
  for (const video of videos) {
    if (video.isShort) {
      if (showShorts && !excludedShortChannels.has(video.channelId ?? "") && !finishedShorts.has(video.id)) {
        shortsForShelf.push(asShort(video));
      }
    } else if (isLiveVideo(video) ? showLive : showVideos) {
      regularVideos.push(video);
    }
  }
  return { shortsForShelf, regularVideos };
}
