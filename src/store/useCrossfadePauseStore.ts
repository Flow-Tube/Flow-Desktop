import { create } from "zustand";

interface CrossfadePauseState {
  /** Crossfade is off from the player's menu until Flow restarts; the saved settings stay as they are. */
  paused: boolean;
  toggle: () => void;
}

export const useCrossfadePauseStore = create<CrossfadePauseState>((set) => ({
  paused: false,
  toggle: () => set((state) => ({ paused: !state.paused })),
}));
