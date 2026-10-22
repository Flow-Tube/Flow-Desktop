import { useEffect, useState } from 'react';
import { getWatchHistory } from './api/db';
import { getString } from './i18n/index';
import type { VideoSummary } from '../types/video';

const HISTORY_WINDOW = 150;

/** What the viewer watched from this channel recently, matched by channel id: names are not unique. */
export function useChannelWatched(channelId: string | undefined, enabled: boolean): VideoSummary[] {
  const [videos, setVideos] = useState<VideoSummary[]>([]);

  useEffect(() => {
    if (!channelId || !enabled) {
      setVideos([]);
      return;
    }
    let cancelled = false;
    getWatchHistory(HISTORY_WINDOW, 0)
      .then((history) => {
        if (cancelled) return;
        setVideos(
          history
            .filter((record) => record.channelId === channelId && !record.isShort)
            .map((record) => ({
              id: record.videoId,
              title: record.title,
              channelName: record.channelName ?? '',
              channelId,
              thumbnailUrl: `https://i.ytimg.com/vi/${record.videoId}/hqdefault.jpg`,
              durationSeconds: record.totalDurationSeconds || null,
              viewCountText: getString('channel_watched_recently'),
            })),
        );
      })
      .catch((err) => console.warn('Failed to read watch history for the channel', err));
    return () => {
      cancelled = true;
    };
  }, [channelId, enabled]);

  return videos;
}
