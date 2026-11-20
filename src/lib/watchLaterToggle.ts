import { showSaveFailedToast, showSaveToast, type SavedItem } from "./saveToast";
import { useWatchLaterStore } from "../store/useWatchLaterStore";
import type { VideoSummary } from "../types/video";

/** Saves a video to Watch later, or takes it out, and says so with Undo or Retry. */
export async function toggleWatchLaterWithToast(video: VideoSummary, item: SavedItem): Promise<void> {
  const { ids, add, remove } = useWatchLaterStore.getState();
  const removing = ids.has(video.id);
  try {
    if (removing) {
      await remove(video.id);
      showSaveToast({ destination: { kind: "watchLater" }, item, removed: true, undo: () => add(video) });
      return;
    }
    await add(video);
    showSaveToast({ destination: { kind: "watchLater" }, item, undo: () => remove(video.id) });
  } catch (error) {
    console.error("Failed to update Watch Later", error);
    showSaveFailedToast({
      destination: { kind: "watchLater" },
      item,
      removed: removing,
      retry: () => toggleWatchLaterWithToast(video, item),
    });
  }
}
