import type { VideoSummary } from "../types/video";

/**
 * A React key per video that stays with the video when the list is re-sorted or grows above it.
 * A position-based key moves to whichever video lands there, so every card below an insert is
 * rebuilt: its thumbnail reloads and its measured height is lost. A video listed twice gets a
 * numbered key for each repeat, since keys must be unique.
 */
export function uniqueVideoKeys(videos: readonly VideoSummary[]): string[] {
  const seen = new Map<string, number>();
  return videos.map((video) => {
    const count = seen.get(video.id) ?? 0;
    seen.set(video.id, count + 1);
    return count === 0 ? video.id : `${video.id}~${count}`;
  });
}
