import { useEffect } from "react";
import { getString } from "./i18n/index";
import { useHistoryStore } from "../store/useHistoryStore";
import type { WatchHistoryRecord } from "../types/db";
import type { VideoSummary } from "../types/video";
import type { SongItem } from "../types/music";

export interface HistoryVideo extends VideoSummary {
  watchDate: string;
  watchProgressPercent: number;
  isMusic: boolean;
}

export function historyVideoToSong(video: HistoryVideo): SongItem {
  const artist = (video.channelName ?? "").replace(/\s*-\s*topic\s*$/i, "").trim();
  return {
    id: video.id,
    title: video.title,
    artists: artist ? [{ name: artist, id: null }] : [],
    album: null,
    duration: video.durationSeconds || null,
    musicVideoType: null,
    thumbnail: video.thumbnailUrl || "",
    explicit: false,
    videoId: video.id,
    playlistId: null,
    params: null,
  };
}

export interface HistoryDateGroup {
  dateLabel: string;
  videos: HistoryVideo[];
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function getHistoryDateLabel(watchDate: string, now = new Date()) {
  const watchedAt = new Date(watchDate);

  if (Number.isNaN(watchedAt.getTime())) {
    return getString("history_date_recently");
  }

  const today = startOfLocalDay(now);
  const watchedDay = startOfLocalDay(watchedAt);
  const dayDiff = Math.floor((today.getTime() - watchedDay.getTime()) / DAY_IN_MS);

  if (dayDiff === 0) return getString("history_date_today");
  if (dayDiff === 1) return getString("history_date_yesterday");
  if (dayDiff > 1 && dayDiff < 7) return getString("history_date_this_week");

  return watchedAt.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function mapHistoryRecordToVideo(record: WatchHistoryRecord): HistoryVideo {
  const duration = record.totalDurationSeconds ?? 0;
  const progress = duration > 0
    ? Math.min(100, Math.max(0, (record.watchDurationSeconds / duration) * 100))
    : 0;

  return {
    id: record.videoId,
    title: record.title,
    channelName: record.channelName || getString("history_unknown_channel"),
    channelId: record.channelId || null,
    thumbnailUrl: `https://i.ytimg.com/vi/${record.videoId}/hqdefault.jpg`,
    durationSeconds: record.totalDurationSeconds || 0,
    publishedText: getHistoryDateLabel(record.watchDate),
    watchDate: record.watchDate,
    watchProgressPercent: progress,
    isMusic: record.isMusic ?? false,
    // A Short stays a Short from history, and opens in the Shorts player.
    isShort: record.isShort ?? false,
  };
}

export function groupHistoryByDate(records: WatchHistoryRecord[]): HistoryDateGroup[] {
  const groups = new Map<string, HistoryVideo[]>();

  for (const record of records) {
    const label = getHistoryDateLabel(record.watchDate);
    const videos = groups.get(label) ?? [];
    videos.push(mapHistoryRecordToVideo(record));
    groups.set(label, videos);
  }

  return Array.from(groups.entries()).map(([dateLabel, videos]) => ({
    dateLabel,
    videos,
  }));
}

export function useHistory() {
  const history = useHistoryStore((state) => state.records);
  const loaded = useHistoryStore((state) => state.loaded);
  const loading = useHistoryStore((state) => state.loading);
  const loadingMore = useHistoryStore((state) => state.loadingMore);
  const hasMore = useHistoryStore((state) => state.hasMore);
  const load = useHistoryStore((state) => state.load);
  const loadMore = useHistoryStore((state) => state.loadMore);
  const offset = useHistoryStore((state) => state.offset);
  const removeHistoryItem = useHistoryStore((state) => state.remove);
  const restoreHistoryItem = useHistoryStore((state) => state.restore);
  const removeShorts = useHistoryStore((state) => state.removeShorts);
  const clearHistory = useHistoryStore((state) => state.clear);

  // Every player writes history straight to SQLite, so the rows here go stale after the first visit.
  useEffect(() => {
    void load(true);
  }, [load]);

  return {
    history,
    loading: loading && !loaded,
    loadingMore,
    hasMore,
    offset,
    loadMore,
    refreshHistory: () => load(true),
    removeHistoryItem,
    restoreHistoryItem,
    removeShorts,
    clearHistory,
  };
}
