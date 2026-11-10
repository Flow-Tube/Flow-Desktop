import { startMusicDownload, startVideoDownload } from "./downloadActions";
import { getPlural, getString } from "./i18n/index";
import { isActiveStatus } from "./useDownloads";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useDownloadStore } from "../store/useDownloadStore";
import { useDownloadsLibraryStore } from "../store/useDownloadsLibraryStore";
import { useUiStore } from "../store/useUiStore";
import type { SongItem } from "../types/music";
import type { VideoSummary } from "../types/video";

export type DownloadTarget = { kind: "video"; video: VideoSummary } | { kind: "music"; song: SongItem };

export const downloadTargetId = (target: DownloadTarget): string =>
  target.kind === "video" ? target.video.id : target.song.videoId ?? target.song.id;

/** Those of `targets` already saved or on their way are left out. */
export async function downloadTargetsNotSaved(targets: DownloadTarget[]): Promise<DownloadTarget[]> {
  const library = useDownloadsLibraryStore.getState();
  await library.ensureLoaded();
  const saved = useDownloadsLibraryStore.getState().downloadedIds;
  const running = new Set(
    Object.values(useDownloadStore.getState().active)
      .filter((item) => isActiveStatus(item.status))
      .map((item) => item.videoId ?? item.id),
  );
  return targets.filter((target) => {
    const id = downloadTargetId(target);
    return !saved.has(id) && !running.has(id);
  });
}

/** Starts each at the default quality, as loose items, and returns how many would not start. The backend queue holds what can't run yet. */
export async function startDownloads(targets: DownloadTarget[]): Promise<number> {
  const values = useAppSettingsStore.getState().values;
  let failed = 0;
  for (const target of targets) {
    try {
      if (target.kind === "video") await startVideoDownload(target.video, values);
      else await startMusicDownload(target.song, values);
    } catch (error) {
      console.warn("A download failed to start", error);
      failed += 1;
    }
  }
  return failed;
}

/** Downloads what isn't saved yet of `targets`, and says how that went. */
export async function downloadManyWithToast(targets: DownloadTarget[]): Promise<void> {
  const { showToast } = useUiStore.getState();
  const pending = await downloadTargetsNotSaved(targets);
  if (pending.length === 0) {
    showToast({ variant: "info", message: getString("downloads_many_nothing_new") });
    return;
  }
  showToast({ variant: "info", message: getPlural("downloads_many_started", pending.length) });
  const failed = await startDownloads(pending);
  if (failed > 0) showToast({ variant: "error", message: getPlural("downloads_many_failed", failed) });
}
