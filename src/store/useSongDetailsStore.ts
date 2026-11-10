import { create } from "zustand";

import type { SongItem } from "../types/music";

interface SongDetailsState {
  song: SongItem | null;
  open: (song: SongItem) => void;
  close: () => void;
}

/** The song the Details dialog is showing, opened from any song menu. */
export const useSongDetailsStore = create<SongDetailsState>((set) => ({
  song: null,
  open: (song) => set({ song }),
  close: () => set({ song: null }),
}));
