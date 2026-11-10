import { PLAYLIST_LIBRARY_UPDATED_EVENT } from "../playlistLibrary";
import { useAlbumLibraryStore } from "../../store/useAlbumLibraryStore";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { useHistoryStore } from "../../store/useHistoryStore";
import { LIKES_LIBRARY_UPDATED_EVENT, useLikesStore } from "../../store/useLikesStore";
import { useNotesStore } from "../../store/useNotesStore";
import { useSubscriptionStore } from "../../store/useSubscriptionStore";

/**
 * A backend restore writes SQLite directly, so the stores that cache it must reload afterwards
 * (mirrors the sync session's `sync://refresh` handling).
 */
export async function refreshAfterRestore(): Promise<void> {
  await useAppSettingsStore.getState().loadSettings();
  useLikesStore.setState({ loaded: false });
  await useLikesStore.getState().load();
  window.dispatchEvent(new Event(LIKES_LIBRARY_UPDATED_EVENT));
  await useAlbumLibraryStore.getState().load();
  window.dispatchEvent(new Event(PLAYLIST_LIBRARY_UPDATED_EVENT));
  await useSubscriptionStore.getState().loadSubscriptions();
  await useSubscriptionStore.getState().loadSubscriptionGroups();
  await useNotesStore.getState().load();
  void useHistoryStore.getState().load(true);
}
