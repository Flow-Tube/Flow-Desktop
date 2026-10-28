import { create } from "zustand";
import type { ThemeFileState } from "../lib/api/themeFile";
import type { ThemeFileTheme } from "../lib/themeFile";

export interface AppliedThemeFile extends ThemeFileTheme {
  /** Remote loads taken out of the file before it was applied. */
  removedRemote: number;
}

interface ThemeFileStore {
  /** The file as last read, whether or not it could be used. */
  file: ThemeFileState | null;
  /** The last version that loaded. A later unreadable write keeps this one on screen. */
  applied: AppliedThemeFile | null;
  setFile: (file: ThemeFileState) => void;
  setApplied: (applied: AppliedThemeFile | null) => void;
}

export const useThemeFileStore = create<ThemeFileStore>((set) => ({
  file: null,
  applied: null,
  setFile: (file) => set({ file }),
  setApplied: (applied) => set({ applied }),
}));
