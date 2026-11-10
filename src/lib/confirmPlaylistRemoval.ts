import { confirmAction } from "./dialogs";
import { getString } from "./i18n/index";
import type { PlaylistSummary } from "../types/video";

/** Asks before a playlist leaves the library: deleted outright when the user made it, else unsaved. */
export function confirmPlaylistRemoval(playlist: PlaylistSummary, owned: boolean): Promise<boolean> {
  return confirmAction({
    title: getString(owned ? "delete_playlist_dialog_title" : "remove_playlist_dialog_title"),
    message: getString(owned ? "delete_playlist_dialog_text" : "remove_playlist_dialog_text", playlist.title),
    item: { title: playlist.title, subtitle: playlist.videoCountText, image: playlist.thumbnailUrl },
    confirmLabel: getString(owned ? "delete" : "remove"),
    destructive: true,
  });
}
