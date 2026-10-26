import { useEffect, useMemo, useState } from "react";

import { getBackendErrorMessage } from "./api/errors";
import { musicDownloadQuality } from "./downloadActions";
import { audioSizeEstimate } from "./downloadOptions";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useCollectionDownloadStore, type CollectionMeta } from "../store/useCollectionDownloadStore";
import { useDownloadCollectionsLibraryStore } from "../store/useDownloadCollectionsLibraryStore";
import type { SongItem } from "../types/music";
import type { VideoSummary } from "../types/video";

const HIGH_KBPS = 128;
const DATA_SAVER_KBPS = 48;

/** An album or playlist the user asked to download, with a way to load its items. */
export type CollectionRequest =
  | { kind: "album"; meta: CollectionMeta; load: () => Promise<SongItem[]> }
  | { kind: "playlist"; meta: CollectionMeta; load: () => Promise<VideoSummary[]> };

export function useCollectionDownloadSheet(request: CollectionRequest | null) {
  const values = useAppSettingsStore((state) => state.values);
  const [items, setItems] = useState<SongItem[] | VideoSummary[]>([]);
  const [quality, setQuality] = useState<"High" | "Low">(() => musicDownloadQuality(values) === "Low" ? "Low" : "High");
  const [folder, setFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const saved = useDownloadCollectionsLibraryStore((state) =>
    request
      ? state.records.find(
          (record) => record.collectionId === request.meta.collectionId && record.kind === request.kind,
        )?.downloadedCount ?? 0
      : 0,
  );

  useEffect(() => {
    setItems([]);
    setFolder(null);
    setError(null);
    if (!request) return;
    let cancelled = false;
    setLoading(true);
    void request
      .load()
      .then((loaded) => {
        if (!cancelled) setItems(loaded);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  const durationSeconds = useMemo(
    () =>
      items.reduce((total, item) => {
        const seconds = "duration" in item ? item.duration : item.durationSeconds;
        return total + (seconds ?? 0);
      }, 0),
    [items],
  );
  const sizes = {
    High: audioSizeEstimate(durationSeconds, HIGH_KBPS),
    Low: audioSizeEstimate(durationSeconds, DATA_SAVER_KBPS),
  };
  const remaining = Math.max(0, items.length - saved);

  const submit = () => {
    if (!request || items.length === 0) return;
    const store = useCollectionDownloadStore.getState();
    const options = { destinationDirectory: folder ?? undefined, musicQuality: quality };
    if (request.kind === "album") void store.startAlbum(request.meta, items as SongItem[], options);
    else void store.startPlaylist(request.meta, items as VideoSummary[], options);
  };

  return {
    durationSeconds,
    errorMessage: error ? getBackendErrorMessage(error) : null,
    folder,
    items,
    loading,
    quality,
    remaining,
    saved,
    setFolder,
    setQuality,
    sizes,
    submit,
  };
}
