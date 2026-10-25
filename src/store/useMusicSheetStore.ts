import { create } from "zustand";

interface MusicSheetState {
  /** The dock is being dragged up, so the full player shows while the view is still the dock. */
  peeking: boolean;
  setPeeking: (peeking: boolean) => void;
}

export const useMusicSheetStore = create<MusicSheetState>((set) => ({
  peeking: false,
  setPeeking: (peeking) => set({ peeking }),
}));
