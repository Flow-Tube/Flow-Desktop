import { useEffect, useMemo } from "react";
import { pinnedFirst } from "./subscriptionPins";
import { sortSubscriptions } from "./subscriptionSort";
import { loadChannelUploadsFromCache } from "./useSubscriptionFeed";
import { useSubscriptionOrder } from "./useSubscriptionOrder";
import { useChannelUploadsStore } from "../store/useChannelUploadsStore";
import { useSubscriptionStore, type SubscribedChannel } from "../store/useSubscriptionStore";

const NO_UPLOADS: string[] = [];

/**
 * Every followed channel as the side rail lists it: the pins first, then the order chosen on the
 * Subscriptions page. "Recent" uses the last feed read; until one is, the stored order shows.
 */
export function useOrderedSubscriptions(): { channels: SubscribedChannel[]; pinnedCount: number } {
  const subscriptions = useSubscriptionStore((state) => state.subscriptions);
  const { sortMode, pins, manualOrder } = useSubscriptionOrder();
  const newestFirst = useChannelUploadsStore((state) => state.newestFirst) ?? NO_UPLOADS;

  useEffect(() => {
    if (sortMode === "recent") void loadChannelUploadsFromCache();
  }, [sortMode]);

  return useMemo(
    () => pinnedFirst(sortSubscriptions(subscriptions, sortMode, { newestFirst, manualOrder }), pins),
    [subscriptions, sortMode, newestFirst, manualOrder, pins],
  );
}
