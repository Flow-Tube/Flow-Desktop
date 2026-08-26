import { create } from "zustand";

import {
  PLAYLIST_LIBRARY_UPDATED_EVENT,
  WATCH_LATER_PLAYLIST_ID,
  addVideoToWatchLater,
  loadStoredPlaylists,
  removeVideoFromWatchLater,
} from "../lib/playlistLibrary";
import type { VideoSummary } from "../types/video";

/**
 * Watch Later membership as a set of video ids.
 *
 * Every video card needs this to label one context-menu entry. Resolving it per
 * card meant `getSetting` — an IPC round trip — plus a `JSON.parse` of the
 * *entire* playlist library, once for each of the several hundred cards a feed
 * mounts. One read into a shared set replaces all of it, and membership becomes
 * a synchronous lookup.
 */
interface WatchLaterState {
  ids: Set<string>;
  loaded: boolean;
  /** Reads the library and replaces the set. Concurrent calls share one read. */
  load: () => Promise<void>;
  add: (video: VideoSummary) => Promise<void>;
  remove: (videoId: string) => Promise<void>;
}

/** Shared by concurrent `load()` calls so a burst cannot stack up reads. */
let inFlight: Promise<void> | null = null;

async function readWatchLaterIds(): Promise<Set<string>> {
  const playlists = await loadStoredPlaylists();
  const watchLater = playlists.find((playlist) => playlist.id === WATCH_LATER_PLAYLIST_ID);
  return new Set(watchLater?.tracks.map((track) => track.id) ?? []);
}

export const useWatchLaterStore = create<WatchLaterState>((set, get) => ({
  ids: new Set<string>(),
  loaded: false,

  load: async () => {
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        set({ ids: await readWatchLaterIds(), loaded: true });
      } catch (error) {
        console.warn("Failed to load Watch Later", error);
        // Leave the previous set in place: a stale label beats dropping every
        // card's saved state because one read failed.
        set({ loaded: true });
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  },

  /*
    Optimistic, then reconciled: `persistStoredPlaylists` dispatches the library
    event on success, which reloads from disk. Only a throw needs the rollback,
    since in that case the event never fires.
  */
  add: async (video) => {
    const previous = get().ids;
    if (previous.has(video.id)) return;
    set({ ids: new Set(previous).add(video.id) });
    try {
      await addVideoToWatchLater(video);
    } catch (error) {
      set({ ids: previous });
      throw error;
    }
  },

  remove: async (videoId) => {
    const previous = get().ids;
    if (!previous.has(videoId)) return;
    const next = new Set(previous);
    next.delete(videoId);
    set({ ids: next });
    try {
      await removeVideoFromWatchLater(videoId);
    } catch (error) {
      set({ ids: previous });
      throw error;
    }
  },
}));

/*
  Every write path — the cards, the library pages, a data import, a sync merge
  from the Android app — funnels through `persistStoredPlaylists`, which fires
  this event. Listening here is what keeps the set correct without any caller
  having to remember to invalidate it.
*/
if (typeof window !== "undefined") {
  window.addEventListener(PLAYLIST_LIBRARY_UPDATED_EVENT, () => {
    if (useWatchLaterStore.getState().loaded) {
      void useWatchLaterStore.getState().load();
    }
  });
}
