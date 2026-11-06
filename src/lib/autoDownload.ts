import { cancelDownload } from "./api/downloads";
import { startMusicDownload, startVideoDownload } from "./downloadActions";
import { getString } from "./i18n/index";
import { SETTINGS } from "./settings/schema";
import { isMusicVideo } from "./utils";
import { isKnownShort } from "./videoKind";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useDownloadStore } from "../store/useDownloadStore";
import { useDownloadsLibraryStore } from "../store/useDownloadsLibraryStore";
import { useUiStore } from "../store/useUiStore";
import type { SongItem } from "../types/music";
import type { VideoSummary } from "../types/video";

let skipNext = false;
let lastSeen: string | null = null;
// Undone this session; nothing else remembers it once the download is cancelled.
const declined = new Set<string>();

/** Autoplay moved on by itself; only what the viewer opens is saved. */
export function skipAutoDownloadForNextVideo() {
  skipNext = true;
}

/** A download already there wins, whatever its state: a failed or paused one was the viewer's call. */
async function alreadyHandled(videoId: string): Promise<boolean> {
  const library = useDownloadsLibraryStore.getState();
  await library.ensureLoaded();
  if (useDownloadsLibraryStore.getState().downloadedIds.has(videoId)) return true;
  return Object.values(useDownloadStore.getState().active).some((item) => (item.videoId ?? item.id) === videoId);
}

/** The player resolved a video. Saves it when "Download videos you open" allows it. */
export async function noteOpenedVideoResolved(video: VideoSummary): Promise<void> {
  if (lastSeen === video.id) return;
  lastSeen = video.id;
  const skipped = skipNext;
  skipNext = false;
  const { values } = useAppSettingsStore.getState();
  if (values[SETTINGS.AUTO_DOWNLOAD_OPENED_VIDEOS] !== "true" || skipped) return;
  if (video.isLive || video.isUpcoming || video.isShort || isKnownShort(video.durationSeconds) || isMusicVideo(video)) return;
  if (declined.has(video.id) || await alreadyHandled(video.id)) return;

  try {
    const started = await startVideoDownload(video, values);
    useUiStore.getState().showToast({
      message: getString("auto_download_queued"),
      actions: [{
        label: getString("undo"),
        onSelect: () => {
          declined.add(video.id);
          void cancelDownload(started.id).catch((error) => console.warn("Failed to cancel a download", error));
        },
      }],
    });
  } catch (error) {
    console.warn("Failed to save an opened video", error);
  }
}

/** A song was just liked. Saves it when "Download liked songs" is on. */
export async function autoDownloadLikedSong(song: SongItem): Promise<void> {
  const { values } = useAppSettingsStore.getState();
  if (values[SETTINGS.AUTO_DOWNLOAD_LIKED_MUSIC] !== "true") return;
  try {
    if (await alreadyHandled(song.videoId ?? song.id)) return;
    await startMusicDownload(song, values);
  } catch (error) {
    console.warn("Failed to save a liked song", error);
  }
}
