import type { SongItem } from "../../types/music";
import type { VideoSummary } from "../../types/video";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { MusicItemCard } from "../music/MusicItemCard";
import { VideoCard } from "../video/VideoCard";
import { LIBRARY_CARD_WIDTH } from "./LibraryShelf";

/** Downloaded videos as the cells of a `LibraryShelf`. */
export function DownloadVideoShelfRow({
  videos,
  onPlay,
}: {
  videos: VideoSummary[];
  onPlay: (video: VideoSummary) => void;
}) {
  return (
    <>
      {videos.map((video, index) => (
        <div key={`${video.id}-${index}`} className="w-[280px] md:w-[320px] shrink-0">
          <VideoCard video={video} onPlay={onPlay} hideChannelAvatar thumbnailWidth={LIBRARY_CARD_WIDTH} />
        </div>
      ))}
    </>
  );
}

/** Downloaded songs as the cells of a `LibraryShelf`; each plays the shelf from itself. */
export function MusicDownloadShelfRow({ songs }: { songs: SongItem[] }) {
  const playQueue = useMusicPlayerStore((s) => s.playQueue);
  return (
    <>
      {songs.map((song, index) => (
        <div key={`${song.id}-${index}`} className="w-[160px] md:w-[200px] shrink-0">
          <MusicItemCard variant="song" item={song} fill onPlay={() => void playQueue(songs, index)} />
        </div>
      ))}
    </>
  );
}
