import { create } from "zustand";
import { channelsByNewestUpload } from "../lib/subscriptionSort";
import type { VideoSummary } from "../types/video";

interface ChannelUploadsState {
  /** Followed channels by latest upload, newest first, from the last subscriptions feed read; null before one is. */
  newestFirst: string[] | null;
  noteFeed: (videos: VideoSummary[]) => void;
}

/** What the "Recent" sort needs outside the Subscriptions page, such as in the side rail. */
export const useChannelUploadsStore = create<ChannelUploadsState>((set) => ({
  newestFirst: null,
  noteFeed: (videos) => {
    if (videos.length > 0) set({ newestFirst: channelsByNewestUpload(videos) });
  },
}));
