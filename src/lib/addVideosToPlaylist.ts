import { getPlural, getString } from "./i18n/index";
import { addVideosToStoredPlaylist, createStoredPlaylist, type StoredPlaylist } from "./playlistLibrary";
import { destinationPath } from "./saveToast";
import { useUiStore } from "../store/useUiStore";
import type { VideoSummary } from "../types/video";

/** Copies `videos` into a playlist and says how that went; false when it could not be saved. */
export async function addVideosToPlaylistWithToast(
  target: Pick<StoredPlaylist, "id" | "name">,
  videos: VideoSummary[],
): Promise<boolean> {
  const { showToast } = useUiStore.getState();
  try {
    const result = await addVideosToStoredPlaylist(target.id, videos);
    if (!result) throw new Error("Playlist not found");
    const path = destinationPath({ kind: "playlist", id: target.id, name: target.name });
    showToast({
      variant: result.added > 0 ? "success" : "info",
      message: result.added > 0
        ? getPlural("merge_playlist_success", result.added, target.name)
        : getString("merge_playlist_already_there", target.name),
      actions: result.added > 0 && path ? [{ label: getString("toast_view"), to: path }] : [],
    });
    return true;
  } catch (error) {
    console.error("Failed to add videos to a playlist", error);
    showToast({ variant: "error", message: getString("merge_playlist_failed") });
    return false;
  }
}

/** Makes a playlist and copies `videos` onto it. */
export async function createPlaylistWithVideos(
  name: string,
  description: string,
  videos: VideoSummary[],
): Promise<boolean> {
  try {
    return await addVideosToPlaylistWithToast(await createStoredPlaylist(name, description), videos);
  } catch (error) {
    console.error("Failed to create a playlist", error);
    useUiStore.getState().showToast({ variant: "error", message: getString("merge_playlist_failed") });
    return false;
  }
}
