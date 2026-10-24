import type { SongItem } from "../../types/music";
import { useDownloadStore } from "../../store/useDownloadStore";
import { saveDownloadLyrics } from "../api/lyrics";
import { getLyrics, lyricsRequestFor } from "./lyricsHelper";
import { lrcText } from "./lrcText";
import { entriesAreSynced } from "./sync";

/** Resolves when the download ends: true once it completed, false if it failed or went away. */
function whenFinished(downloadId: string): Promise<boolean> {
  return new Promise((resolve) => {
    let seen = false;
    let unsubscribe: () => void = () => {};
    const check = (active: ReturnType<typeof useDownloadStore.getState>["active"]): boolean => {
      const item = active[downloadId];
      if (!item) {
        if (!seen) return false;
        resolve(false);
        return true;
      }
      seen = true;
      if (item.status === "completed") resolve(true);
      else if (item.status === "failed" || item.status === "cancelled") resolve(false);
      else return false;
      return true;
    };
    if (check(useDownloadStore.getState().active)) return;
    unsubscribe = useDownloadStore.subscribe((state) => {
      if (check(state.active)) unsubscribe();
    });
  });
}

/**
 * Saves the provider chain's lyrics next to a downloaded song, synced when any provider had
 * timing. The lookup starts with the download and is shared with the player when the same song
 * plays; the backend's plain YouTube lyrics stay only when the chain found nothing.
 */
export function saveLyricsWithDownload(track: SongItem, downloadId: string): void {
  const request = lyricsRequestFor(track, track.duration ?? 0);
  void Promise.all([getLyrics(request).catch(() => null), whenFinished(downloadId)])
    .then(([result, finished]) => {
      // "Downloaded" is the song's own saved file coming back; there is nothing to improve.
      if (!finished || !result || result.provider === "Downloaded") return;
      const synced = entriesAreSynced(result.entries);
      const text = lrcText(synced ? result.entries : [], result.entries.map((e) => e.text).join("\n"));
      return saveDownloadLyrics(request.videoId, text);
    })
    .catch(() => {});
}
