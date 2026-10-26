import { useNavigate } from "react-router-dom";

import { revealDownload, type DownloadProgress } from "./api/downloads";
import { downloadArtwork, downloadRecordToSong, downloadRecordToVideo, findDownloadedRecord } from "./useDownloads";
import { useDownloadsLibraryStore } from "../store/useDownloadsLibraryStore";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { usePlayerStore } from "../store/usePlayerStore";

const libraryKind = (progress: DownloadProgress) => (progress.mediaKind === "video" ? "video" : "audio");

/** A download's artwork: the cover Flow saved once it has finished, the item's
 *  thumbnail before that. */
export function useDownloadItemArtwork(progress: DownloadProgress): string | null {
  return useDownloadsLibraryStore((state) => {
    const record = state.records.find(
      (candidate) =>
        candidate.videoId === progress.videoId
        && (libraryKind(progress) === "video"
          ? candidate.mediaKind === "video"
          : candidate.mediaKind !== "video"),
    );
    return record ? downloadArtwork(record) : progress.thumbnailUrl;
  });
}

/** What a finished download's card can do: play the saved file, or show it on disk. */
export function useDownloadItemActions() {
  const navigate = useNavigate();
  const setQueue = usePlayerStore((state) => state.setQueue);
  const playQueue = useMusicPlayerStore((state) => state.playQueue);

  const play = (progress: DownloadProgress) => {
    const record = findDownloadedRecord(progress.videoId, libraryKind(progress));
    if (!record) return;
    if (record.mediaKind === "video") {
      const video = downloadRecordToVideo(record);
      setQueue([video], 0);
      navigate(`/watch/${video.id}`);
    } else {
      void playQueue([downloadRecordToSong(record)], 0);
    }
  };

  const reveal = (progress: DownloadProgress) => {
    if (!progress.videoId) return;
    void revealDownload(progress.videoId, progress.mediaKind).catch(() => {});
  };

  return { play, reveal };
}
