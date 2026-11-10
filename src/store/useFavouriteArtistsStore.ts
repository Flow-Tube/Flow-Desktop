import { create } from "zustand";
import { getSetting, setSetting } from "../lib/api/db";
import { setFavouriteMusicArtist } from "../lib/api/music";
import { getString } from "../lib/i18n/index";
import { useUiStore } from "./useUiStore";

const STORE_KEY = "favourite_artists";

export interface FavouriteArtist {
  id: string;
  name: string;
  thumbnailUrl: string;
}

interface FavouriteArtistsState {
  /** The brain only keeps their affinity, which listening keeps changing, so the picks live here. */
  picked: FavouriteArtist[];
  loaded: boolean;
  load: () => Promise<void>;
  /** Picks or unpicks at once; goes back if the music brain or the save fails. */
  toggle: (artist: FavouriteArtist) => Promise<void>;
}

export const useFavouriteArtistsStore = create<FavouriteArtistsState>((set, get) => ({
  picked: [],
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    try {
      const raw = await getSetting(STORE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      set({ picked: Array.isArray(parsed) ? (parsed as FavouriteArtist[]) : [], loaded: true });
    } catch (error) {
      console.warn("Failed to read picked artists", error);
      set({ loaded: true });
    }
  },
  toggle: async (artist) => {
    const previous = get().picked;
    const removing = previous.some((other) => other.id === artist.id);
    const next = removing ? previous.filter((other) => other.id !== artist.id) : [...previous, artist];
    set({ picked: next });
    try {
      await setFavouriteMusicArtist(artist.id, artist.name, !removing);
      await setSetting(STORE_KEY, JSON.stringify(next));
    } catch (error) {
      console.error("Failed to save the picked artist", error);
      set({ picked: previous });
      useUiStore.getState().showToast({ variant: "error", message: getString("feed_action_failed") });
    }
  },
}));
