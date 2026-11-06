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
