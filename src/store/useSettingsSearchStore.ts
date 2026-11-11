import { create } from "zustand";

interface SettingsSearchState {
  query: string;
  setQuery: (query: string) => void;
  clearQuery: () => void;
}

export const useSettingsSearchStore = create<SettingsSearchState>((set) => ({
  query: "",
  setQuery: (query: string) => set({ query }),
  clearQuery: () => set({ query: "" }),
}));
