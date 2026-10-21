import { useCallback, useEffect, useState } from "react";
import { getWatchHistory } from "./api/db";
import { getHiddenContinueWatchingIds, hideContinueWatchingVideo } from "./continueWatching";
import { getString } from "./i18n/index";
import { mapHistoryRecordToVideo } from "./useHistory";
import { isKnownShort } from "./videoKind";
import type { WatchHistoryRecord } from "../types/db";
import type { VideoSummary } from "../types/video";

const SHELF_SIZE = 20;
const FINISHED_PERCENT = 90;

/** Videos started but not finished, newest first, songs, Shorts and hidden ones left out. */
export function buildContinueWatching(history: WatchHistoryRecord[], hidden: Set<string>): VideoSummary[] {
  const seen = new Set<string>();
  const videos: VideoSummary[] = [];
  for (const record of history) {
    if (seen.has(record.videoId) || hidden.has(record.videoId) || record.isMusic) continue;
    seen.add(record.videoId);
    const duration = record.totalDurationSeconds ?? 0;
    // A Short swiped away is not one to resume.
    if (duration <= 0 || record.watchDurationSeconds <= 0 || isKnownShort(duration)) continue;
    const percent = Math.min(100, Math.max(0, (record.watchDurationSeconds / duration) * 100));
    if (percent >= FINISHED_PERCENT) continue;
    videos.push({
      ...mapHistoryRecordToVideo(record),
      viewCountText: getString("continue_watching_progress", Math.round(percent)),
    });
  }
  return videos.slice(0, SHELF_SIZE);
}

/** Home's Continue Watching shelf. */
export function useContinueWatching(enabled: boolean) {
  const [videos, setVideos] = useState<VideoSummary[]>([]);

  useEffect(() => {
    if (!enabled) {
      setVideos([]);
      return;
    }
    let cancelled = false;
    getWatchHistory(200, 0)
      .then((history) => {
        if (!cancelled) setVideos(buildContinueWatching(history, getHiddenContinueWatchingIds()));
      })
      .catch((error) => {
        console.error("Failed to load Continue Watching", error);
        if (!cancelled) setVideos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const hide = useCallback((videoId: string) => {
    hideContinueWatchingVideo(videoId);
    setVideos((current) => current.filter((video) => video.id !== videoId));
  }, []);

  return { videos, hide };
}
