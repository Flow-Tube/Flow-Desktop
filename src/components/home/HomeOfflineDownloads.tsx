import { Download, Music2 } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { useDownloadShelves } from "../../lib/downloadShelves";
import { useMusicEnabled } from "../../lib/useMusicContent";
import type { VideoSummary } from "../../types/video";
import { DownloadVideoShelfRow, MusicDownloadShelfRow } from "../library/DownloadShelfRows";
import { LibraryShelf } from "../library/LibraryShelf";

/**
 * What still plays when Home couldn't load and has nothing saved: the downloads, as
 * Library shows them. Nothing at all when there are none.
 */
export function HomeOfflineDownloads({ onPlay }: { onPlay: (video: VideoSummary) => void }) {
  const musicEnabled = useMusicEnabled();
  const shelves = useDownloadShelves(true);
  const videos = shelves?.videos ?? [];
  const songs = musicEnabled ? shelves?.songs ?? [] : [];
  if (videos.length === 0 && songs.length === 0) return null;

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-chrome-neutral-400">{getString("home_offline_downloads_hint")}</p>
      {videos.length > 0 && (
        <LibraryShelf title={getString("library_video_downloads_label")} icon={Download} viewAllTo="/downloads">
          <DownloadVideoShelfRow videos={videos} onPlay={onPlay} />
        </LibraryShelf>
      )}
      {songs.length > 0 && (
        <LibraryShelf title={getString("library_music_downloads_label")} icon={Music2} viewAllTo="/downloads">
          <MusicDownloadShelfRow songs={songs} />
        </LibraryShelf>
      )}
    </div>
  );
}
