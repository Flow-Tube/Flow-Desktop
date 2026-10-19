import { create } from "zustand";

interface ImageProxyState {
  /** `http://127.0.0.1:<port>/img/<token>` in the Linux AppImage, else null. */
  base: string | null;
  setBase: (base: string | null) => void;
}

export const useImageProxyStore = create<ImageProxyState>((set) => ({
  base: null,
  setBase: (base) => set({ base }),
}));
