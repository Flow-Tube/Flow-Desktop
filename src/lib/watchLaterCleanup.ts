import { getWatchRecords } from "./api/db";
import { getPlural, getString } from "./i18n/index";
import {
  removeVideosFromStoredPlaylist,
  restoreStoredPlaylistTracks,
  getStoredPlaylistById,
  WATCH_LATER_PLAYLIST_ID,
} from "./playlistLibrary";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useUiStore } from "../store/useUiStore";
import { useWatchLaterStore } from "../store/useWatchLaterStore";
import type { VideoSummary } from "../types/video";

// Android's default watched threshold: 90% seen and under a minute left.
const WATCHED_MIN_PERCENT = 90;
const WATCHED_MAX_REMAINING_SECONDS = 60;

export function countsAsWatched(positionSeconds: number, durationSeconds: number): boolean {
  if (positionSeconds <= 0 || durationSeconds <= 0) return false;
  return (
    (positionSeconds / durationSeconds) * 100 >= WATCHED_MIN_PERCENT
    && durationSeconds - positionSeconds <= WATCHED_MAX_REMAINING_SECONDS
  );
}

const switchedOn = () => useAppSettingsStore.getState().values[SETTINGS.REMOVE_WATCHED_FROM_WATCH_LATER] === "true";

async function removeIfSaved(videoId: string) {
  const store = useWatchLaterStore.getState();
  if (!store.loaded) await store.load();
  try {
    await useWatchLaterStore.getState().remove(videoId);
  } catch (error) {
    console.warn("Failed to take a watched video out of Watch Later", error);
  }
}

/** A video leaves Watch Later as its progress crosses the watched threshold. */
export function noteWatchLaterProgress(videoId: string, positionSeconds: number, durationSeconds: number) {
  if (switchedOn() && countsAsWatched(positionSeconds, durationSeconds)) void removeIfSaved(videoId);
}

/** The video played to its end. */
export function noteWatchLaterFinished(videoId: string) {
  if (switchedOn()) void removeIfSaved(videoId);
}

/**
 * Opening Watch Later sweeps out any that were watched elsewhere, with an Undo. `onChanged` gets
 * the list after the sweep and after an undo.
 */
export async function sweepWatchedFromWatchLater(
  videos: VideoSummary[],
  onChanged: (videos: VideoSummary[]) => void,
): Promise<void> {
  if (!switchedOn() || videos.length === 0) return;
  const { showToast } = useUiStore.getState();
  const reload = async () => onChanged((await getStoredPlaylistById(WATCH_LATER_PLAYLIST_ID))?.tracks ?? []);
  try {
    const records = await getWatchRecords(videos.map((video) => video.id));
    const watched = records
      .filter((record) => countsAsWatched(record.watchDurationSeconds, record.totalDurationSeconds ?? 0))
      .map((record) => record.videoId);
    if (watched.length === 0) return;

    const removed = await removeVideosFromStoredPlaylist(WATCH_LATER_PLAYLIST_ID, new Set(watched));
    if (removed.length === 0) return;
    await reload();
    showToast({
      message: getPlural("watch_later_watched_removed", removed.length),
      actions: [{
        label: getString("undo"),
        onSelect: () => {
          void restoreStoredPlaylistTracks(WATCH_LATER_PLAYLIST_ID, removed)
            .then(reload)
            .catch((error) => {
              console.error("Failed to put watched videos back", error);
              showToast({ variant: "error", message: getString("toast_action_failed") });
            });
        },
      }],
    });
  } catch (error) {
    console.warn("Failed to sweep watched videos from Watch Later", error);
  }
}
