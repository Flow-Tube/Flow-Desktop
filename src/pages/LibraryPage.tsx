import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, Disc3, Download, FolderOpen, History, ListVideo, Music2, ThumbsUp } from "lucide-react";
import type { VideoSummary } from "../types/video";
import type { SongItem } from "../types/music";
import { getString } from "../lib/i18n/index";
import { hiddenOnLibraryPage, useHiddenLibrarySections } from "../lib/librarySections";
import { useShortsEnabled, videosWithShorts } from "../lib/useShortsContent";
import { useLibrary, type LibraryPlaylist } from "../lib/useLibrary";
import { historyVideoToSong, type HistoryVideo } from "../lib/useHistory";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import {
  albumDetailPath,
  storedAlbumToItem,
  type StoredAlbum,
} from "../store/useAlbumLibraryStore";
import { LibraryShelf } from "../components/library/LibraryShelf";
import { RecapEntryCard } from "../components/recap/RecapEntryCard";
import { Button } from "../components/ui/Button";
import { VideoCard } from "../components/video/VideoCard";
import { PlaylistCard } from "../components/video/PlaylistCard";
import { MusicItemCard } from "../components/music/MusicItemCard";
import { ShortCard } from "../components/shorts/ShortCard";
import { NotesShelf } from "../components/note/NotesShelf";
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
          <VideoCard video={video} onPlay={onPlay} />
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
          finiteQueue
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

  const shortsEnabled = useShortsEnabled();
  const hidden = hiddenOnLibraryPage(useHiddenLibrarySections(), shortsEnabled);

  const isEmpty = (length: number) => !loading && length === 0;

  const statsText = shortsEnabled
    ? getString("library_stats_summary", playlists.length, savedAlbums.length, savedShorts.length)
    : getString("library_stats_summary_no_shorts", playlists.length, savedAlbums.length);
  const historyShown = videosWithShorts(history, shortsEnabled);

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
        <Button type="button" variant="tonal" className="ms-auto shrink-0" onClick={() => navigate("/local-media")}>
          <FolderOpen size={16} />
          {getString("library_local_media_label")}
        </Button>
      </header>

      <RecapEntryCard />

      {!hidden.has("HISTORY") && (
        <LibraryShelf
          title={getString("library_history_label")}
          icon={History}
          viewAllTo="/history"
          isEmpty={isEmpty(historyShown.length)}
        >
          <HistoryShelfRow items={historyShown} onPlay={onPlay} onAddToQueue={onAddToQueue} />
        </LibraryShelf>
      )}

      {!hidden.has("PLAYLISTS") && (
        <LibraryShelf
          title={getString("library_playlists_label")}
          icon={ListVideo}
          viewAllTo="/playlists"
          isEmpty={isEmpty(playlists.length)}
        >
          <PlaylistShelfRow playlists={playlists} />
        </LibraryShelf>
      )}

      {!hidden.has("ALBUMS") && (
        <LibraryShelf
          title={getString("albums_title")}
          icon={Disc3}
          viewAllTo="/albums"
          isEmpty={isEmpty(savedAlbums.length)}
        >
          <AlbumShelfRow albums={savedAlbums} onOpenAlbum={handleOpenAlbum} />
        </LibraryShelf>
      )}

      {!hidden.has("SAVED_SHORTS") && (
        <LibraryShelf
          title={getString("library_saved_shorts_label")}
          icon={ShortsIcon}
          viewAllTo="/saved-shorts"
          isEmpty={isEmpty(savedShorts.length)}
        >
          <ShortsShelfRow shorts={savedShorts} />
        </LibraryShelf>
      )}

      {!hidden.has("WATCH_LATER") && (
        <LibraryShelf
          title={getString("library_watch_later_label")}
          icon={Clock}
          viewAllTo="/watch-later"
          isEmpty={isEmpty(watchLater.length)}
        >
          <VideoShelfRow videos={watchLater} onPlay={onPlay} onAddToQueue={onAddToQueue} />
        </LibraryShelf>
      )}

      {!hidden.has("LIKES") && (
        <LibraryShelf
          title={getString("library_likes_label")}
          icon={ThumbsUp}
          viewAllTo="/liked"
          isEmpty={isEmpty(liked.length)}
        >
          <HistoryShelfRow items={liked} onPlay={onPlay} onAddToQueue={onAddToQueue} />
        </LibraryShelf>
      )}

      {!hidden.has("NOTES") && <NotesShelf />}

      {!hidden.has("VIDEO_DOWNLOADS") && (
        <LibraryShelf
          title={getString("library_video_downloads_label")}
          icon={Download}
          viewAllTo="/downloads"
          isEmpty={isEmpty(videoDownloads.length)}
        >
          <DownloadVideoShelfRow videos={videoDownloads} onPlay={onPlay} />
        </LibraryShelf>
      )}

      {!hidden.has("MUSIC_DOWNLOADS") && (
        <LibraryShelf
          title={getString("library_music_downloads_label")}
          icon={Music2}
          viewAllTo="/downloads"
          isEmpty={isEmpty(musicDownloads.length)}
        >
          <MusicDownloadShelfRow songs={musicDownloads} />
        </LibraryShelf>
      )}
    </div>
  );
};

export default LibraryPage;
