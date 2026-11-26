import { useCallback, useMemo } from "react";
import { SETTINGS } from "./settings/schema";
import { channelIdsToStorage, parseChannelIds, reorderSubset, togglePinned } from "./subscriptionPins";
import { reorderedManualOrder, type SubscriptionSortMode } from "./subscriptionSort";
import { setSettingValue, useAppSettingsStore } from "../store/useAppSettingsStore";
import { useSubscriptionStore } from "../store/useSubscriptionStore";

const storedIds = (key: typeof SETTINGS.SUBS_PINNED_CHANNELS | typeof SETTINGS.SUBS_MANUAL_ORDER) =>
  parseChannelIds(useAppSettingsStore.getState().values[key]);

/**
 * The viewer's subscription order: the sort, the pins and the dragged manual order, with the
 * actions that change them. Each change shows at once and is undone if it can't be saved.
 */
export function useSubscriptionOrder() {
  const sortMode = useAppSettingsStore((state) => state.values[SETTINGS.SUBS_SORT_MODE] ?? "") as SubscriptionSortMode;
  const pinsRaw = useAppSettingsStore((state) => state.values[SETTINGS.SUBS_PINNED_CHANNELS]);
  const manualRaw = useAppSettingsStore((state) => state.values[SETTINGS.SUBS_MANUAL_ORDER]);
  const pins = useMemo(() => parseChannelIds(pinsRaw), [pinsRaw]);
  const manualOrder = useMemo(() => parseChannelIds(manualRaw), [manualRaw]);

  const setSortMode = useCallback((mode: SubscriptionSortMode) => {
    void setSettingValue(SETTINGS.SUBS_SORT_MODE, mode);
  }, []);

  const togglePin = useCallback((channelId: string) => {
    const next = togglePinned(storedIds(SETTINGS.SUBS_PINNED_CHANNELS), channelId);
    void setSettingValue(SETTINGS.SUBS_PINNED_CHANNELS, channelIdsToStorage(next));
  }, []);

  /** `shown` is the pins a list shows, in their new order. */
  const reorderPins = useCallback((shown: string[]) => {
    const next = reorderSubset(storedIds(SETTINGS.SUBS_PINNED_CHANNELS), shown);
    void setSettingValue(SETTINGS.SUBS_PINNED_CHANNELS, channelIdsToStorage(next));
  }, []);

  /** `shown` is the channels a list shows, in their new order; the others keep their places. */
  const reorderManual = useCallback((shown: string[]) => {
    const next = reorderedManualOrder(useSubscriptionStore.getState().subscriptions, storedIds(SETTINGS.SUBS_MANUAL_ORDER), shown);
    void setSettingValue(SETTINGS.SUBS_MANUAL_ORDER, channelIdsToStorage(next));
  }, []);

  return { sortMode, setSortMode, pins, togglePin, reorderPins, manualOrder, reorderManual };
}
