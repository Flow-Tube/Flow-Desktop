export interface WatchHistoryRecord {
  id?: number | null;
  videoId: string;
  title: string;
  channelName?: string | null;
  channelId?: string | null;
  watchDate: string;
  watchDurationSeconds: number;
  totalDurationSeconds?: number | null;
  isMusic?: boolean;
  /** Watched in the Shorts player; a Short stays a Short whatever its length. */
  isShort?: boolean;
}
