import { create } from "zustand";
import { getSetting, setSetting } from "../lib/api/db";
import type { AlbumItem, Artist, SongItem } from "../types/music";

const ALBUMS_SETTING_KEY = "saved_albums";

export type AlbumSource = "Owned" | "Saved";

export interface StoredAlbum {
  id: string;
  title: string;
  source: AlbumSource;
  description?: string;
  artists?: Artist[] | null;
  year?: number | null;
  thumbnail?: string | null;
  explicit?: boolean;
  browseId?: string; 
  playlistId?: string;
  tracks?: SongItem[];
  createdAt?: string;
}

const songVideoId = (track: SongItem): string => track.videoId ?? track.id;

/** Album card art: explicit thumbnail, else the first owned track's art. */
const albumThumbnail = (album: StoredAlbum): string =>
  album.thumbnail ?? album.tracks?.find((t) => t.thumbnail)?.thumbnail ?? "";

/** Maps any stored album to the AlbumItem shape the album card expects. */
export function storedAlbumToItem(album: StoredAlbum): AlbumItem {
  return {
    browseId: album.browseId ?? album.id,
    playlistId: album.playlistId ?? "",
    title: album.title,
    artists: album.artists ?? null,
    year: album.year ?? null,
    thumbnail: albumThumbnail(album),
    explicit: album.explicit ?? false,
  };
}

/**
 * Route an album opens to — both saved and owned albums use the music album
 * page; owned albums are served locally by it via their generated id.
 */
export function albumDetailPath(album: StoredAlbum): string {
  return `/music/album/${album.browseId ?? album.id}`;
}

/** Normalize persisted entries, upgrading legacy raw AlbumItem[] to StoredAlbum. */
function normalizeStoredAlbum(raw: AlbumItem | StoredAlbum): StoredAlbum {
  if ("source" in raw && raw.source) {
    return { ...raw, tracks: raw.tracks ?? (raw.source === "Owned" ? [] : undefined) };
  }
  const album = raw as AlbumItem;
  return {
    id: album.browseId,
    title: album.title,
    source: "Saved",
    artists: album.artists,
    year: album.year,
    thumbnail: album.thumbnail,
    explicit: album.explicit,
    browseId: album.browseId,
    playlistId: album.playlistId,
  };
}

interface AlbumLibraryState {
  albums: StoredAlbum[];
  loaded: boolean;
  addTargets: SongItem[];
  searchAlbumId: string | null;

  load: () => Promise<void>;
  getById: (id: string) => StoredAlbum | undefined;
  isSaved: (id: string) => boolean;
  toggle: (album: AlbumItem) => Promise<boolean>;
  createAlbum: (name: string, description?: string) => Promise<StoredAlbum>;
  saveMix: (id: string, title: string, tracks: SongItem[]) => Promise<void>;
  /** A new album of your own holding `tracks`, as read from a playlist file. */
  importAlbum: (title: string, description: string, tracks: SongItem[]) => Promise<StoredAlbum>;
  removeAlbum: (id: string) => Promise<void>;
  addTrack: (albumId: string, track: SongItem) => Promise<void>;
  removeTrack: (albumId: string, trackVideoId: string) => Promise<void>;
  /** Adds the songs not already there and returns the ones that went in. */
  addTracks: (albumId: string, tracks: SongItem[]) => Promise<SongItem[]>;
  removeTracks: (albumId: string, trackVideoIds: string[]) => Promise<void>;
  /** Puts a list back as it was, for Undo. */
  restoreTracks: (albumId: string, tracks: SongItem[]) => Promise<void>;
  updateDetails: (albumId: string, title: string, description: string) => Promise<void>;

  openAddToAlbum: (tracks: SongItem | SongItem[]) => void;
  closeAddToAlbum: () => void;
  openTrackSearch: (albumId: string) => void;
  closeTrackSearch: () => void;
}

const persist = async (albums: StoredAlbum[]) => {
  try {
    await setSetting(ALBUMS_SETTING_KEY, JSON.stringify(albums));
  } catch (error) {
    console.warn("Failed to persist albums", error);
  }
};

export const useAlbumLibraryStore = create<AlbumLibraryState>((set, get) => {
  /** Shows a change at once and takes it back if it can't be saved. */
  const commit = async (next: StoredAlbum[]) => {
    const previous = get().albums;
    set({ albums: next });
    try {
      await setSetting(ALBUMS_SETTING_KEY, JSON.stringify(next));
    } catch (error) {
      set({ albums: previous });
      throw error;
    }
  };
  const editOwned = (albumId: string, edit: (album: StoredAlbum) => StoredAlbum) =>
    commit(get().albums.map((album) => (album.id === albumId && album.source === "Owned" ? edit(album) : album)));

  return {
  albums: [],
  loaded: false,
  addTargets: [],
  searchAlbumId: null,

  load: async () => {
    try {
      const json = await getSetting(ALBUMS_SETTING_KEY);
      const parsed = json ? (JSON.parse(json) as Array<AlbumItem | StoredAlbum>) : [];
      const albums = Array.isArray(parsed) ? parsed.map(normalizeStoredAlbum) : [];
      set({ albums, loaded: true });
    } catch (error) {
      console.warn("Failed to load albums", error);
      set({ loaded: true });
    }
  },

  getById: (id) => get().albums.find((album) => album.id === id),

  isSaved: (id) => get().albums.some((album) => album.id === id),

  toggle: async (album) => {
    if (get().isSaved(album.browseId)) {
      await get().removeAlbum(album.browseId);
      return false;
    }
    const stored: StoredAlbum = {
      id: album.browseId,
      title: album.title,
      source: "Saved",
      artists: album.artists,
      year: album.year,
      thumbnail: album.thumbnail,
      explicit: album.explicit,
      browseId: album.browseId,
      playlistId: album.playlistId,
      createdAt: new Date().toISOString(),
    };
    const updated = [...get().albums, stored];
    set({ albums: updated });
    await persist(updated);
    return true;
  },

  createAlbum: async (name, description) => {
    const album: StoredAlbum = {
      id: `album-${Date.now()}`,
      title: name.trim() || "Untitled album",
      source: "Owned",
      description: description?.trim() || "",
      tracks: [],
      thumbnail: null,
      createdAt: new Date().toISOString(),
    };
    const updated = [...get().albums, album];
    set({ albums: updated });
    await persist(updated);
    return album;
  },

  saveMix: async (id, title, tracks) => {
    const previous = get().albums;
    const album: StoredAlbum = {
      id, title, source: "Owned", tracks,
      thumbnail: tracks[0]?.thumbnail ?? null,
      createdAt: new Date().toISOString(),
    };
    const next = [...previous.filter((item) => item.id !== id), album];
    set({ albums: next });
    try {
      await setSetting(ALBUMS_SETTING_KEY, JSON.stringify(next));
    } catch (error) {
      set({ albums: previous });
      throw error;
    }
  },

  importAlbum: async (title, description, tracks) => {
    const album: StoredAlbum = {
      id: `album-${Date.now()}`,
      title,
      source: "Owned",
      description,
      tracks,
      thumbnail: tracks[0]?.thumbnail ?? null,
      createdAt: new Date().toISOString(),
    };
    const previous = get().albums;
    const next = [...previous, album];
    set({ albums: next });
    try {
      await setSetting(ALBUMS_SETTING_KEY, JSON.stringify(next));
    } catch (error) {
      set({ albums: previous });
      throw error;
    }
    return album;
  },

  removeAlbum: async (id) => {
    const updated = get().albums.filter((album) => album.id !== id);
    set({ albums: updated });
    await persist(updated);
  },

  addTrack: async (albumId, track) => {
    const updated = get().albums.map((album) => {
      if (album.id !== albumId || album.source !== "Owned") return album;
      const tracks = album.tracks ?? [];
      if (tracks.some((t) => songVideoId(t) === songVideoId(track))) return album;
      const nextTracks = [...tracks, track];
      return {
        ...album,
        tracks: nextTracks,
        thumbnail: album.thumbnail ?? track.thumbnail ?? null,
      };
    });
    set({ albums: updated });
    await persist(updated);
  },

  removeTrack: async (albumId, trackVideoId) => {
    const updated = get().albums.map((album) => {
      if (album.id !== albumId || album.source !== "Owned") return album;
      return {
        ...album,
        tracks: (album.tracks ?? []).filter((t) => songVideoId(t) !== trackVideoId),
      };
    });
    set({ albums: updated });
    await persist(updated);
  },

  addTracks: async (albumId, tracks) => {
    const album = get().albums.find((candidate) => candidate.id === albumId && candidate.source === "Owned");
    if (!album) return [];
    const seen = new Set((album.tracks ?? []).map(songVideoId));
    const added = tracks.filter((track) => {
      const id = songVideoId(track);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (added.length === 0) return [];
    await editOwned(albumId, (current) => ({
      ...current,
      tracks: [...(current.tracks ?? []), ...added],
      thumbnail: current.thumbnail ?? added.find((track) => track.thumbnail)?.thumbnail ?? null,
    }));
    return added;
  },

  removeTracks: (albumId, trackVideoIds) => {
    const removed = new Set(trackVideoIds);
    return editOwned(albumId, (album) => ({
      ...album,
      tracks: (album.tracks ?? []).filter((track) => !removed.has(songVideoId(track))),
    }));
  },

  restoreTracks: (albumId, tracks) => editOwned(albumId, (album) => ({ ...album, tracks })),

  updateDetails: (albumId, title, description) =>
    editOwned(albumId, (album) => ({ ...album, title: title.trim() || album.title, description: description.trim() })),

  openAddToAlbum: (tracks) => set({ addTargets: Array.isArray(tracks) ? tracks : [tracks] }),
  closeAddToAlbum: () => set({ addTargets: [] }),
  openTrackSearch: (albumId) => set({ searchAlbumId: albumId }),
  closeTrackSearch: () => set({ searchAlbumId: null }),
  };
});
