import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, Disc3, Download, History, ListVideo, Music2, ThumbsUp } from "lucide-react";
import type { VideoSummary } from "../types/video";
import type { SongItem } from "../types/music";
import { getString } from "../lib/i18n/index";
import { SETTINGS } from "../lib/settings/schema";
import { useLibrary, type LibraryPlaylist } from "../lib/useLibrary";
import { historyVideoToSong, type HistoryVideo } from "../lib/useHistory";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import {
  albumDetailPath,
  storedAlbumToItem,
  type StoredAlbum,
} from "../store/useAlbumLibraryStore";
import { LibraryShelf } from "../components/library/LibraryShelf";
import { VideoCard } from "../components/video/VideoCard";
import { PlaylistCard } from "../components/video/PlaylistCard";
import { MusicItemCard } from "../components/music/MusicItemCard";
import { DownloadVideoCard } from "../components/downloads/DownloadVideoCard";
import { ShortCard } from "../components/shorts/ShortCard";
import { ShortsIcon } from "../components/ui/ShortsIcon";
import type { ShortVideoSummary } from "../types/video";

const videoIdOf = (item: { videoId?: string | null; id: string }) => item.videoId ?? item.id;

function HistoryShelfRow({
  items,
  onPlay,
  onAddToQueue,
}: {
  items: HistoryVideo[];
  onPlay: (video: VideoSummary) => void;
  onAddToQueue?: (video: VideoSummary) => void;
}) {
  const playQueue = useMusicPlayerStore((s) => s.playQueue);
  const musicSongs = useMemo(
    () => items.filter((item) => item.isMusic).map(historyVideoToSong),
    [items],
  );

  return (
    <>
      {items.map((item, index) => {
        if (item.isMusic) {
          const song = historyVideoToSong(item);
          const queueIndex = Math.max(
            0,
            musicSongs.findIndex((s) => videoIdOf(s) === videoIdOf(song)),
          );
          return (
            <div key={`${item.id}-${index}`} className="w-[160px] md:w-[200px] shrink-0">
              <MusicItemCard
                variant="song"
                item={song}
                fill
                onPlay={() => void playQueue(musicSongs, queueIndex)}
              />
            </div>
          );
        }
        return (
          <div key={`${item.id}-${index}`} className="w-[280px] md:w-[320px] shrink-0">
            <VideoCard
              video={item}
              onPlay={onPlay}
              onAddToQueue={onAddToQueue}
              variant="grid"
              hideChannelAvatar
            />
          </div>
        );
      })}
    </>
  );
}

interface LibraryPageProps {
  onPlay: (video: VideoSummary) => void;
  onAddToQueue?: (video: VideoSummary) => void;
}

function VideoShelfRow({
  videos,
  onPlay,
  onAddToQueue,
}: {
  videos: VideoSummary[];
  onPlay: (video: VideoSummary) => void;
  onAddToQueue?: (video: VideoSummary) => void;
}) {
  return (
    <>
      {videos.map((video, index) => (
        <div
          key={`${video.id}-${index}`}
          className="w-[280px] md:w-[320px] shrink-0"
        >
          <VideoCard
            video={video}
            onPlay={onPlay}
            onAddToQueue={onAddToQueue}
            variant="grid"
            hideChannelAvatar
          />
        </div>
      ))}
    </>
  );
}

function PlaylistShelfRow({ playlists }: { playlists: LibraryPlaylist[] }) {
  return (
    <>
      {playlists.map((playlist) => (
        <div key={playlist.id} className="w-[200px] shrink-0">
          <PlaylistCard playlist={playlist} />
        </div>
      ))}
    </>
  );
}

function AlbumShelfRow({
  albums,
  onOpenAlbum,
}: {
  albums: StoredAlbum[];
  onOpenAlbum: (album: StoredAlbum) => void;
}) {
  return (
    <>
      {albums.map((album) => (
        <div key={album.id} className="w-[160px] md:w-[200px] shrink-0">
          <MusicItemCard
            variant="album"
            item={storedAlbumToItem(album)}
            fill
            onOpen={() => onOpenAlbum(album)}
            onPlay={() => onOpenAlbum(album)}
          />
        </div>
      ))}
    </>
  );
}

function DownloadVideoShelfRow({
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
          <DownloadVideoCard video={video} onPlay={onPlay} />
        </div>
      ))}
    </>
  );
}

function MusicDownloadShelfRow({ songs }: { songs: SongItem[] }) {
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

function ShortsShelfRow({ shorts }: { shorts: ShortVideoSummary[] }) {
  return (
    <>
      {shorts.map((short) => (
        <ShortCard
          key={short.id}
          short={short}
          queue={shorts}
          variant="shelf"
        />
      ))}
    </>
  );
}

export const LibraryPage: React.FC<LibraryPageProps> = ({ onPlay, onAddToQueue }) => {
  const navigate = useNavigate();
  const {
    history,
    playlists,
    savedAlbums,
    watchLater,
    liked,
    savedShorts,
    videoDownloads,
    musicDownloads,
    loading,
  } = useLibrary();

  const showMusicNav = useAppSettingsStore((state) => state.values[SETTINGS.MUSIC_NAVIGATION_ENABLED] !== "false");
  const showShortsNav = useAppSettingsStore((state) => state.values[SETTINGS.SHORTS_NAVIGATION_ENABLED] !== "false");

  const visibleHistory = useMemo(
    () => (showMusicNav ? history : history.filter((item) => !item.isMusic)),
    [history, showMusicNav],
  );
  const visibleLiked = useMemo(
    () => (showMusicNav ? liked : liked.filter((item) => !item.isMusic)),
    [liked, showMusicNav],
  );

  const isEmpty = (length: number) => !loading && length === 0;

  const statsText = getString(
    "library_stats_summary",
    playlists.length,
    showMusicNav ? savedAlbums.length : 0,
    showShortsNav ? savedShorts.length : 0,
  );

  const handleOpenAlbum = (album: StoredAlbum) => {
    navigate(albumDetailPath(album));
  };

  return (
    <div className="max-w-[1800px] mx-auto px-6 md:px-8 pt-8 pb-12 flex flex-col gap-10">
      <header className="flex items-center gap-5">

        <div className="min-w-0">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-chrome-neutral-100">
            {getString("library_page_title")}
          </h1>
          <p className="mt-2 text-sm text-chrome-neutral-400">{statsText}</p>
        </div>
      </header>

      {/* History */}
      <LibraryShelf
        title={getString("library_history_label")}
        icon={History}
        viewAllTo="/history"
        isEmpty={isEmpty(visibleHistory.length)}
      >
        <HistoryShelfRow items={visibleHistory} onPlay={onPlay} onAddToQueue={onAddToQueue} />
      </LibraryShelf>

      {/* Playlists */}
      <LibraryShelf
        title={getString("library_playlists_label")}
        icon={ListVideo}
        viewAllTo="/playlists"
        isEmpty={isEmpty(playlists.length)}
      >
        <PlaylistShelfRow playlists={playlists} />
      </LibraryShelf>

      {/* Albums */}
      {showMusicNav && (
        <LibraryShelf
          title={getString("albums_title")}
          icon={Disc3}
          viewAllTo="/albums"
          isEmpty={isEmpty(savedAlbums.length)}
        >
          <AlbumShelfRow albums={savedAlbums} onOpenAlbum={handleOpenAlbum} />
        </LibraryShelf>
      )}

      {/* Saved Shorts */}
      {showShortsNav && (
        <LibraryShelf
          title={getString("library_saved_shorts_label")}
          icon={ShortsIcon}
          viewAllTo="/saved-shorts"
          isEmpty={isEmpty(savedShorts.length)}
        >
          <ShortsShelfRow shorts={savedShorts} />
        </LibraryShelf>
      )}

      {/* Watch Later */}
      <LibraryShelf
        title={getString("library_watch_later_label")}
        icon={Clock}
        viewAllTo="/watch-later"
        isEmpty={isEmpty(watchLater.length)}
      >
        <VideoShelfRow videos={watchLater} onPlay={onPlay} onAddToQueue={onAddToQueue} />
      </LibraryShelf>

      {/* Likes */}
      <LibraryShelf
        title={getString("library_likes_label")}
        icon={ThumbsUp}
        viewAllTo="/liked"
        isEmpty={isEmpty(visibleLiked.length)}
      >
        <HistoryShelfRow items={visibleLiked} onPlay={onPlay} onAddToQueue={onAddToQueue} />
      </LibraryShelf>

      {/* Video downloads */}
      <LibraryShelf
        title={getString("library_video_downloads_label")}
        icon={Download}
        viewAllTo="/downloads"
        isEmpty={isEmpty(videoDownloads.length)}
      >
        <DownloadVideoShelfRow videos={videoDownloads} onPlay={onPlay} />
      </LibraryShelf>

      {/* Music downloads */}
      {showMusicNav && (
        <LibraryShelf
          title={getString("library_music_downloads_label")}
          icon={Music2}
          viewAllTo="/downloads"
          isEmpty={isEmpty(musicDownloads.length)}
        >
          <MusicDownloadShelfRow songs={musicDownloads} />
        </LibraryShelf>
      )}

      {/* STEP 5 — MD3 empty states */}
    </div>
  );
};

export default LibraryPage;
