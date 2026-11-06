import { invokeBackend } from "./errors";

export type ViewFormat = "LONG" | "SHORT" | "LIVE";
export type LedgerAction = "LIKE" | "SAVE" | "DOWNLOAD" | "NOT_INTERESTED" | "BLOCK_CHANNEL" | "SEARCH";

export interface RecapViewEvent {
  videoId: string;
  title: string;
  channelId: string;
  channelName: string;
  channelAvatarUrl?: string;
  description?: string | null;
  format: ViewFormat;
  watchedMs: number;
  counted: boolean;
  skipped: boolean;
  continued: boolean;
}

export interface RecapListenEvent {
  trackId: string;
  title: string;
  artistId?: string | null;
  artistName: string;
  artworkUrl?: string;
  listenedMs: number;
  counted: boolean;
  skipped: boolean;
  continued: boolean;
}

export type RecapEntry =
  | ({ kind: "view"; atMs: number } & RecapViewEvent)
  | ({ kind: "listen"; atMs: number } & RecapListenEvent)
  | { kind: "dislike"; atMs: number; videoId: string; title: string; channelName: string }
  | { kind: "dislikeRemoved"; atMs: number; videoId: string }
  | { kind: "action"; atMs: number; action: LedgerAction }
  | { kind: "search"; atMs: number; query: string | null }
  | { kind: "sponsorSkip"; atMs: number; category: string; skippedMs: number }
  | { kind: "artistSaidNo"; atMs: number; artistId: string | null; artistName: string; blocked: boolean }
  | { kind: "queriesCleared" };

export function recordRecapBatch(entries: RecapEntry[]): Promise<void> {
  return invokeBackend<void>("recap_record_batch", { entries });
}

export type RecapSource = "ALL" | "VIDEO" | "MUSIC";
export type RankedKind = "CHANNEL" | "VIDEO" | "ARTIST" | "TRACK" | "OTHER";
export type RecapInsight =
  | "NIGHT_OWL"
  | "EARLY_BIRD"
  | "WEEKEND_WATCHER"
  | "LOYAL"
  | "EXPLORER"
  | "MARATHON"
  | "TIME_SAVER";

export interface RankedItem {
  id: string;
  name: string;
  count: number;
  durationMs: number;
  detail: string;
  imageUrl: string;
  kind: RankedKind;
}

export interface ActivityPattern {
  totalMs: number;
  /** Local date "2026-09-14" to time spent. */
  dayMs: Record<string, number>;
  /** Counted views or plays per hour of day. */
  hourCounts: number[];
  /** Counted views or plays per weekday, Monday first. */
  weekdayCounts: number[];
  activeDays: number;
  longestStreak: number;
  busiestDay: [string, number] | null;
}

export interface DislikedVideo {
  videoId: string;
  title: string;
  channelName: string;
  at: number;
}

export interface VideoRecap {
  views: number;
  sessions: number;
  activity: ActivityPattern;
  formatMs: Partial<Record<ViewFormat, number>>;
  topChannels: RankedItem[];
  topVideos: RankedItem[];
  topTopics: RankedItem[];
  newTopics: string[];
  discoveredChannels: RankedItem[];
  skippedVideos: RankedItem[];
  dislikes: DislikedVideo[];
  actions: Partial<Record<LedgerAction, number>>;
  topQueries: RankedItem[];
  sponsorSkippedMs: Record<string, number>;
  sponsorSavedMs: number;
}

export interface MusicRecap {
  plays: number;
  sessions: number;
  activity: ActivityPattern;
  topArtists: RankedItem[];
  topTracks: RankedItem[];
  discoveredArtists: RankedItem[];
  skippedTracks: RankedItem[];
  dislikedArtists: RankedItem[];
  blockedArtists: RankedItem[];
}

export interface RecapSummary {
  video: VideoRecap;
  music: MusicRecap;
  combined: ActivityPattern;
  previousTotalMs: number | null;
  insights: RecapInsight[];
  estimated: boolean;
}

export interface RecapIndex {
  startedAt: number;
  /** Newest first, each with that month's views and plays. */
  months: [string, number][];
  /** Channel id, name and distinct videos in watch history. */
  historyChannels: [string, string, number][];
}

export function getRecapIndex(): Promise<RecapIndex> {
  return invokeBackend<RecapIndex>("recap_index");
}

/** `period` is "2026-09", "2026" or "all". */
export function getRecapSummary(period: string, source: RecapSource): Promise<RecapSummary> {
  return invokeBackend<RecapSummary>("recap_summary", { period, source });
}
