import { useEffect, useMemo } from "react";
import { usePreference } from "./usePreference";
import { SETTINGS } from "./settings/schema";
import { sortSubscriptions, type SubscriptionSortMode } from "./subscriptionSort";
import { loadChannelUploadsFromCache } from "./useSubscriptionFeed";
import { useChannelUploadsStore } from "../store/useChannelUploadsStore";
import { useSubscriptionStore, type SubscribedChannel } from "../store/useSubscriptionStore";

const NO_UPLOADS: string[] = [];

/**
 * Every followed channel in the order chosen on the Subscriptions page, for lists outside it
 * such as the side rail. "Recent" uses the last feed read; until one is, the stored order shows.
 */
export function useOrderedSubscriptions(): SubscribedChannel[] {
  const subscriptions = useSubscriptionStore((state) => state.subscriptions);
  const [sortMode] = usePreference(SETTINGS.SUBS_SORT_MODE);
  const mode = sortMode as SubscriptionSortMode;
  const newestFirst = useChannelUploadsStore((state) => state.newestFirst) ?? NO_UPLOADS;

  useEffect(() => {
    if (mode === "recent") void loadChannelUploadsFromCache();
  }, [mode]);

  return useMemo(() => sortSubscriptions(subscriptions, mode, newestFirst), [subscriptions, mode, newestFirst]);
}
