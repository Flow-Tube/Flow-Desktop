import type { RankedItem, RecapSummary } from "../api/recap";

/** One card of the recap story. Each exists only when its period has the data to fill it. */
export type StoryPage =
  | { kind: "intro" }
  | { kind: "topChannel"; channel: RankedItem; runnersUp: RankedItem[] }
  | { kind: "onRepeat"; video: RankedItem }
  | { kind: "topics" }
  | { kind: "clock" }
  | { kind: "streak" }
  | { kind: "topArtist"; artist: RankedItem; sharePercent: number }
  | { kind: "songs" }
  | { kind: "newToYou" }
  | { kind: "passedOn" }
  | { kind: "formats" }
  | { kind: "sponsor" }
  | { kind: "summary" };

const MIN_REPEAT = 2;
const RUNNERS_UP = 4;
const MIN_STREAK = 2;

/** The story for `summary`: always an intro and a summary, and between them what the period earned. */
export function storyPages(summary: RecapSummary): StoryPage[] {
  const { video, music, combined } = summary;
  const pages: StoryPage[] = [{ kind: "intro" }];
  const channel = video.topChannels[0];
  if (channel) pages.push({ kind: "topChannel", channel, runnersUp: video.topChannels.slice(1, 1 + RUNNERS_UP) });
  const repeated = video.topVideos[0];
  if (repeated && repeated.count >= MIN_REPEAT) pages.push({ kind: "onRepeat", video: repeated });
  if (video.topTopics.length > 0) pages.push({ kind: "topics" });
  if (combined.hourCounts.some((count) => count > 0)) pages.push({ kind: "clock" });
  if (combined.longestStreak >= MIN_STREAK) pages.push({ kind: "streak" });
  const artist = music.topArtists[0];
  if (artist) {
    const sharePercent = music.plays > 0 ? Math.floor((artist.count * 100) / music.plays) : 0;
    pages.push({ kind: "topArtist", artist, sharePercent });
  }
  if (music.topTracks.length >= MIN_REPEAT) pages.push({ kind: "songs" });
  if (video.discoveredChannels.length > 0 || music.discoveredArtists.length > 0) pages.push({ kind: "newToYou" });
  if (video.dislikes.length > 0 || video.skippedVideos.length > 0 || music.skippedTracks.length > 0) pages.push({ kind: "passedOn" });
  const formats = Object.keys(video.formatMs).length + (music.activity.totalMs > 0 ? 1 : 0);
  if (formats >= MIN_REPEAT) pages.push({ kind: "formats" });
  if (video.sponsorSavedMs > 0) pages.push({ kind: "sponsor" });
  pages.push({ kind: "summary" });
  return pages;
}
