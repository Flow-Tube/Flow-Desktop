import { create } from "zustand";

interface HoverPreviewState {
  activeVideoId: string | null;
  setActiveVideoId: (id: string | null) => void;
  clearActive: (id?: string) => void;
}

export const useHoverPreviewStore = create<HoverPreviewState>((set) => ({
  activeVideoId: null,
  setActiveVideoId: (id) => set({ activeVideoId: id }),
  clearActive: (id) =>
    set((state) => {
      if (!id || state.activeVideoId === id) {
        return { activeVideoId: null };
      }
      return state;
    }),
}));
