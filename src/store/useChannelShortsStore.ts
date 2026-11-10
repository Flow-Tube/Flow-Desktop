import { create } from "zustand";
import { getSetting, setSetting } from "../lib/api/db";
import { useUiStore } from "./useUiStore";
import { getString } from "../lib/i18n/index";

const EXCLUDED_KEY = "subscription_shorts_excluded_channels";

interface ChannelShortsState {
  /** Channels whose Shorts stay out of the subscription feed. */
  excluded: Set<string>;
  loaded: boolean;
  load: () => Promise<void>;
  /** Flips one channel at once; goes back if the write fails. */
  toggle: (channelId: string) => Promise<void>;
}

export const useChannelShortsStore = create<ChannelShortsState>((set, get) => ({
  excluded: new Set(),
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    try {
      const raw = await getSetting(EXCLUDED_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      set({ excluded: new Set(Array.isArray(parsed) ? (parsed as string[]) : []), loaded: true });
    } catch (error) {
      console.warn("Failed to read hidden channel Shorts", error);
      set({ loaded: true });
    }
  },
  toggle: async (channelId) => {
    const previous = get().excluded;
    const next = new Set(previous);
    if (next.has(channelId)) next.delete(channelId);
    else next.add(channelId);
    set({ excluded: next });
    try {
      await setSetting(EXCLUDED_KEY, JSON.stringify([...next]));
    } catch (error) {
      console.error("Failed to save hidden channel Shorts", error);
      set({ excluded: previous });
      useUiStore.getState().showToast({ variant: "error", message: getString("feed_action_failed") });
    }
  },
}));
