import { LIKES_LIBRARY_UPDATED_EVENT, useLikesStore } from "../store/useLikesStore";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { useAlbumLibraryStore } from "../store/useAlbumLibraryStore";
import { HISTORY_UPDATED_EVENT, useHistoryStore } from "../store/useHistoryStore";
import { useSubscriptionStore } from "../store/useSubscriptionStore";
import { useNotificationStore } from "../store/useNotificationStore";
import { useFeedActionsStore } from "../store/useFeedActionsStore";
import { useMusicActionsStore } from "../store/useMusicActionsStore";
import { PLAYLIST_LIBRARY_UPDATED_EVENT } from "./playlistLibrary";
import { SAVED_SHORTS_LIBRARY_UPDATED_EVENT } from "./savedShortsLibrary";
import { isSettingKey } from "./settings/values";

/*
  The Zustand stores load from SQLite once and then trust themselves. Anything
  that writes SQLite behind their back (a sync merge, a restore, another Flow
  window) reloads them through here.
*/

async function reloadLikes(): Promise<void> {
  useLikesStore.setState({ loaded: false });
  await useLikesStore.getState().load();
  window.dispatchEvent(new Event(LIKES_LIBRARY_UPDATED_EVENT));
}

async function reloadPlaylists(): Promise<void> {
  await useAlbumLibraryStore.getState().load();
  window.dispatchEvent(new Event(PLAYLIST_LIBRARY_UPDATED_EVENT));
}

/** Fired after a sync merged either recommendation brain, which the backend already reloaded. */
export const BRAINS_UPDATED_EVENT = "flow:brains-updated";

async function reloadHistory(): Promise<void> {
  if (useHistoryStore.getState().loaded) await useHistoryStore.getState().load(true);
  window.dispatchEvent(new Event(HISTORY_UPDATED_EVENT));
}

async function reloadSettings(): Promise<void> {
  await Promise.all([useAppSettingsStore.getState().loadSettings(), useSettingsStore.getState().loadSettings()]);
}

/** Collections named by a sync merge (`sync://refresh`). */
export async function refreshSyncedCollections(collections: string[]): Promise<void> {
  try {
    if (collections.includes("watch_history")) await reloadHistory();
    if (collections.includes("flow_neuro_brain") || collections.includes("music_brain")) {
      window.dispatchEvent(new Event(BRAINS_UPDATED_EVENT));
    }
    if (collections.includes("likes")) await reloadLikes();
    if (collections.includes("settings")) await reloadSettings();
    if (collections.includes("playlists")) await reloadPlaylists();
    if (collections.includes("subscribed_channels")) await useSubscriptionStore.getState().loadSubscriptions();
    if (collections.includes("subscriptions")) await useSubscriptionStore.getState().loadSubscriptionGroups();
  } catch (error) {
    console.warn("Failed to refresh local stores after sync", error);
  }
}

const RELOAD_BY_SETTING_KEY: Record<string, () => Promise<void> | void> = {
  liked_items: reloadLikes,
  user_playlists: reloadPlaylists,
  saved_shorts_library: () => {
    window.dispatchEvent(new Event(SAVED_SHORTS_LIBRARY_UPDATED_EVENT));
  },
  subscriptions: () => useSubscriptionStore.getState().loadSubscriptions(),
  subscription_groups: () => useSubscriptionStore.getState().loadSubscriptionGroups(),
  subscription_notifications: () => useNotificationStore.getState().loadChannelPreferences(),
  feed_actions_state_v1: () => {
    useFeedActionsStore.setState({ loaded: false });
    return useFeedActionsStore.getState().load();
  },
  music_actions_state_v1: () => {
    useMusicActionsStore.setState({ loaded: false });
    return useMusicActionsStore.getState().load();
  },
};

/** Reloads whatever caches the stored values another window just changed. */
export async function refreshForSettingKeys(keys: string[]): Promise<void> {
  const reloads = new Set<() => Promise<void> | void>();
  for (const key of keys) {
    const reload = RELOAD_BY_SETTING_KEY[key] ?? (isSettingKey(key) ? reloadSettings : null);
    if (reload) reloads.add(reload);
  }
  try {
    await Promise.all([...reloads].map((reload) => reload()));
  } catch (error) {
    console.warn("Failed to refresh stores changed in another window", error);
  }
}
