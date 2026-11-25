import { create } from "zustand";
import { getWatchedCountByChannel } from "../lib/api/db";

interface ChannelWatchCountsState {
  /** Videos watched per channel id; null until first read. */
  counts: Record<string, number> | null;
  /** Reads the counts again. A failed read keeps the last ones, and Most watched falls back to the stored order. */
  load: () => Promise<void>;
}

/** What the Most watched subscriptions sort reads. */
export const useChannelWatchCountsStore = create<ChannelWatchCountsState>((set) => ({
  counts: null,
  load: async () => {
    try {
      set({ counts: await getWatchedCountByChannel() });
    } catch (err) {
      console.warn("Failed to read watch counts per channel", err);
    }
  },
}));
