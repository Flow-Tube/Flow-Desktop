import { useEffect, useState } from "react";
import { listDownloads, type DownloadRecord } from "./api/downloads";
import { downloadRecordToSong, downloadRecordToVideo } from "./useDownloads";
import type { SongItem } from "../types/music";
import type { VideoSummary } from "../types/video";

/** How many downloads a shelf previews before its View all. */
export const DOWNLOAD_SHELF_LIMIT = 15;

export interface DownloadShelves {
  videos: VideoSummary[];
  songs: SongItem[];
}

/** Single downloads split into a video shelf and a song shelf; collections live on the Downloads page. */
export function downloadShelves(records: DownloadRecord[], limit = DOWNLOAD_SHELF_LIMIT): DownloadShelves {
  const singles = records.filter((record) => record.collectionDbId == null);
  return {
    videos: singles.filter((record) => record.mediaKind === "video").slice(0, limit).map(downloadRecordToVideo),
    songs: singles.filter((record) => record.mediaKind !== "video").slice(0, limit).map(downloadRecordToSong),
  };
}

/** The download shelves, read once while `enabled`; null until they're known. */
export function useDownloadShelves(enabled: boolean): DownloadShelves | null {
  const [shelves, setShelves] = useState<DownloadShelves | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    listDownloads()
      .then((records) => {
        if (current) setShelves(downloadShelves(records));
      })
      .catch((error) => console.warn("Download shelves failed to load", error));
    return () => {
      current = false;
    };
  }, [enabled]);
  return enabled ? shelves : null;
}
