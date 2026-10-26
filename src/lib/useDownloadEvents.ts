import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

import { restoreDownloads, type DownloadProgress } from "./api/downloads";
import { notifyDownloadInBackground } from "./downloadNotifications";
import { isTauriEnv } from "./api/env";
import { getString } from "./i18n/index";
import { useCollectionDownloadStore } from "../store/useCollectionDownloadStore";
import { useDownloadCollectionsLibraryStore } from "../store/useDownloadCollectionsLibraryStore";
import { useDownloadsLibraryStore } from "../store/useDownloadsLibraryStore";
import { useDownloadStore } from "../store/useDownloadStore";

function onProgress(progress: DownloadProgress): void {
  useDownloadStore.getState().updateProgress(progress);
  useCollectionDownloadStore.getState().handleProgress(progress);
  if (progress.status === "completed") {
    void useDownloadsLibraryStore.getState().load();
    if (progress.collectionDbId != null) void useDownloadCollectionsLibraryStore.getState().load();
  }
  // Album and playlist items are announced once, when the whole run ends.
  if (progress.collectionDbId == null) {
    if (progress.status === "completed") {
      notifyDownloadInBackground(getString("download_notification_complete"), progress.title);
    } else if (progress.status === "failed") {
      notifyDownloadInBackground(getString("download_notification_failed"), progress.title);
    }
  }
}

/** Follows download progress from the backend, and on start resumes downloads a
 *  previous run left unfinished so every unfinished one shows in the dock. */
export function useDownloadEvents(): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void isTauriEnv().then(async (tauri) => {
      if (!tauri) return;
      const stop = await listen<DownloadProgress>("download-progress", (event) => onProgress(event.payload));
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
      const unfinished = await restoreDownloads().catch(() => []);
      for (const progress of unfinished) useDownloadStore.getState().updateProgress(progress);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
