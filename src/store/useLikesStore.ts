import { create } from "zustand";
import { getSetting, setSetting } from "../lib/api/db";
import { getMusicQueue } from "../lib/api/music";
import { autoDownloadLikedSong } from "../lib/autoDownload";
import type { SongItem } from "../types/music";
import type { VideoSummary } from "../types/video";

export const LIKES_LIBRARY_UPDATED_EVENT = "flow:likes-library-updated";
const LIKES_SETTING_KEY = "liked_items";

export type LikedItemKind = "video" | "music";

export interface LikedVideoItem {
  kind: "video";
  id: string;
  likedAt: string;
  video: VideoSummary;
}

export interface LikedMusicItem {
  kind: "music";
  id: string;
  likedAt: string;
  song: SongItem;
}

export type LikedItem = LikedVideoItem | LikedMusicItem;

const songId = (song: SongItem) => song.videoId ?? song.id;
const itemKey = (kind: LikedItemKind, id: string) => `${kind}:${id}`;

function isStubMusicLike(item: LikedItem): item is LikedMusicItem {
  if (item.kind !== "music") return false;
  const song = item.song;
  if (!song) return true;
  const hasTitle = Boolean(song.title && song.title.trim());
  const hasArtist = Boolean(song.artists?.some((a) => a?.name));
  return !hasTitle || !hasArtist;
}

function normalizeItems(items: LikedItem[]) {
  return [...items].sort((a, b) => Date.parse(b.likedAt) - Date.parse(a.likedAt));
}

async function persist(items: LikedItem[]) {
  await setSetting(LIKES_SETTING_KEY, JSON.stringify(normalizeItems(items)));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LIKES_LIBRARY_UPDATED_EVENT));
  }
}

interface LikesState {
  items: LikedItem[];
  loaded: boolean;
  load: () => Promise<void>;
  enrichStubs: () => Promise<void>;
  isLikedVideo: (videoId: string) => boolean;
  isLikedSong: (song: SongItem) => boolean;
  toggleVideo: (video: VideoSummary) => Promise<boolean>;
  toggleSong: (song: SongItem) => Promise<boolean>;
  remove: (kind: LikedItemKind, id: string) => Promise<void>;
  /** Unlikes several in one write and returns them for Undo; nothing changes if the write fails. */
  removeMany: (items: LikedItem[]) => Promise<LikedItem[]>;
  /** Puts unliked items back as they were, keeping when each was liked. */
  restore: (items: LikedItem[]) => Promise<void>;
  clear: () => Promise<void>;
}

export const useLikesStore = create<LikesState>((set, get) => ({
  items: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    try {
      const raw = await getSetting(LIKES_SETTING_KEY);
      const parsed = raw ? (JSON.parse(raw) as LikedItem[]) : [];
      set({ items: normalizeItems(Array.isArray(parsed) ? parsed : []), loaded: true });
    } catch (error) {
      console.warn("Failed to load likes", error);
      set({ loaded: true });
    }
    void get().enrichStubs();
  },

  enrichStubs: async () => {
    const stubs = get().items.filter(isStubMusicLike);
    if (stubs.length === 0) return;
    const ids = Array.from(
      new Set(
        stubs
          .map((item) => item.song?.videoId ?? item.song?.id ?? item.id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (ids.length === 0) return;

    const fetched = new Map<string, SongItem>();
    try {
      for (let i = 0; i < ids.length; i += 50) {
        const page = await getMusicQueue(ids.slice(i, i + 50));
        for (const song of page.items) {
          if (song.videoId) fetched.set(song.videoId, song);
          if (song.id) fetched.set(song.id, song);
        }
      }
    } catch (error) {
      console.warn("Failed to enrich liked songs", error);
      return;
    }
    if (fetched.size === 0) return;

    let changed = false;
    const next = get().items.map((item) => {
      if (!isStubMusicLike(item)) return item;
      const key = item.song?.videoId ?? item.song?.id ?? item.id;
      const song = key ? fetched.get(key) : undefined;
      if (!song) return item;
      changed = true;
      return { ...item, song };
    });
    if (!changed) return;
    set({ items: normalizeItems(next) });
    await persist(next);
  },

  isLikedVideo: (videoId) => get().items.some((item) => (
    item.kind === "video" && item.id === videoId
  )),

  isLikedSong: (song) => {
    const id = songId(song);
    return get().items.some((item) => item.kind === "music" && item.id === id);
  },

  toggleVideo: async (video) => {
    await get().load();
    const key = itemKey("video", video.id);
    const exists = get().items.some((item) => itemKey(item.kind, item.id) === key);
    const next = exists
      ? get().items.filter((item) => itemKey(item.kind, item.id) !== key)
      : [
          {
            kind: "video" as const,
            id: video.id,
            likedAt: new Date().toISOString(),
            video,
          },
          ...get().items,
        ];
    set({ items: normalizeItems(next) });
    await persist(next);
    return !exists;
  },

  toggleSong: async (song) => {
    await get().load();
    const id = songId(song);
    const key = itemKey("music", id);
    const exists = get().items.some((item) => itemKey(item.kind, item.id) === key);
    const next = exists
      ? get().items.filter((item) => itemKey(item.kind, item.id) !== key)
      : [
          {
            kind: "music" as const,
            id,
            likedAt: new Date().toISOString(),
            song,
          },
          ...get().items,
        ];
    set({ items: normalizeItems(next) });
    await persist(next);
    if (!exists) void autoDownloadLikedSong(song);
    return !exists;
  },

  remove: async (kind, id) => {
    await get().load();
    const key = itemKey(kind, id);
    const next = get().items.filter((item) => itemKey(item.kind, item.id) !== key);
    set({ items: normalizeItems(next) });
    await persist(next);
  },

  removeMany: async (items) => {
    await get().load();
    const keys = new Set(items.map((item) => itemKey(item.kind, item.id)));
    const previous = get().items;
    const removed = previous.filter((item) => keys.has(itemKey(item.kind, item.id)));
    const next = previous.filter((item) => !keys.has(itemKey(item.kind, item.id)));
    set({ items: next });
    try {
      await persist(next);
    } catch (error) {
      set({ items: previous });
      throw error;
    }
    return removed;
  },

  restore: async (items) => {
    await get().load();
    const previous = get().items;
    const held = new Set(previous.map((item) => itemKey(item.kind, item.id)));
    const next = normalizeItems([...previous, ...items.filter((item) => !held.has(itemKey(item.kind, item.id)))]);
    set({ items: next });
    try {
      await persist(next);
    } catch (error) {
      set({ items: previous });
      throw error;
    }
  },

  clear: async () => {
    set({ items: [] });
    await persist([]);
  },
}));
