import { useEffect, useMemo } from "react";
import { pinnedFirst } from "./subscriptionPins";
import { sortSubscriptions } from "./subscriptionSort";
import { loadChannelUploadsFromCache } from "./useSubscriptionFeed";
import { useSubscriptionOrder } from "./useSubscriptionOrder";
import { useChannelUploadsStore } from "../store/useChannelUploadsStore";
import { useChannelWatchCountsStore } from "../store/useChannelWatchCountsStore";
import { useSubscriptionStore, type SubscribedChannel } from "../store/useSubscriptionStore";

const NO_UPLOADS: string[] = [];
const NO_COUNTS: Record<string, number> = {};

/**
 * Every followed channel as the side rail lists it: the pins first, then the order chosen on the
 * Subscriptions page. "Recent" uses the last feed read; until one is, the stored order shows.
 */
export function useOrderedSubscriptions(): { channels: SubscribedChannel[]; pinnedCount: number } {
  const subscriptions = useSubscriptionStore((state) => state.subscriptions);
  const { sortMode, pins, manualOrder } = useSubscriptionOrder();
  const newestFirst = useChannelUploadsStore((state) => state.newestFirst) ?? NO_UPLOADS;
  const watchCounts = useChannelWatchCountsStore((state) => state.counts) ?? NO_COUNTS;

  useEffect(() => {
    if (sortMode === "recent") void loadChannelUploadsFromCache();
    if (sortMode === "watched") void useChannelWatchCountsStore.getState().load();
  }, [sortMode]);

  return useMemo(
    () => pinnedFirst(sortSubscriptions(subscriptions, sortMode, { newestFirst, manualOrder, watchCounts }), pins),
    [subscriptions, sortMode, newestFirst, manualOrder, watchCounts, pins],
  );
}
