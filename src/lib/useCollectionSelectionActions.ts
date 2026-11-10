import { getPlural, getString } from './i18n/index';
import { startMusicDownload } from './downloadActions';
import { showSaveToast } from './saveToast';
import { songToastItem } from './songLikeToast';
import { albumDetailPath, useAlbumLibraryStore, type StoredAlbum } from '../store/useAlbumLibraryStore';
import { useAppSettingsStore } from '../store/useAppSettingsStore';
import { useDownloadsLibraryStore } from '../store/useDownloadsLibraryStore';
import { useMusicPlayerStore } from '../store/useMusicPlayerStore';
import { useUiStore } from '../store/useUiStore';
import type { SongItem } from '../types/music';

const songId = (song: SongItem) => song.videoId ?? song.id;

function songsToastItem(songs: SongItem[]) {
  const [only] = songs;
  if (only && songs.length === 1) return songToastItem(only);
  return { title: getPlural('music_song_count', songs.length), image: songs[0]?.thumbnail, shape: 'square' as const };
}

/** Takes songs out of your own list, with Undo putting the list back as it was. */
export async function removeSongsWithUndo(album: StoredAlbum, songs: SongItem[]): Promise<void> {
  const store = useAlbumLibraryStore.getState();
  const before = album.tracks ?? [];
  const destination = { kind: 'album' as const, path: albumDetailPath(album), name: album.title };
  try {
    await store.removeTracks(album.id, songs.map(songId));
    showSaveToast({
      destination,
      item: songsToastItem(songs),
      removed: true,
      undo: () => useAlbumLibraryStore.getState().restoreTracks(album.id, before),
    });
  } catch (error) {
    console.error('Failed to remove songs from the album', error);
    useUiStore.getState().showToast({ variant: 'error', message: getString('toast_action_failed') });
  }
}

/** Picked songs save as loose downloads, so they don't count as this page's own download. */
export async function downloadSongs(songs: SongItem[]): Promise<void> {
  const values = useAppSettingsStore.getState().values;
  const results = await Promise.allSettled(songs.map((song) => startMusicDownload(song, values)));
  const queued = results.filter((result) => result.status === 'fulfilled').length;
  void useDownloadsLibraryStore.getState().load();
  useUiStore.getState().showToast(
    queued > 0
      ? { variant: 'success', message: getPlural('music_songs_download_queued', queued) }
      : { variant: 'error', message: getString('toast_action_failed') },
  );
}

/** The first picked song plays first, so they go in behind the current one in reverse. With nothing playing, they start. */
export function playSongsNext(songs: SongItem[]): void {
  const { currentTrack, playNextInQueue, playQueue } = useMusicPlayerStore.getState();
  if (!currentTrack) {
    void playQueue(songs, 0);
    return;
  }
  [...songs].reverse().forEach((song) => playNextInQueue(song));
}

export function addSongsToQueue(songs: SongItem[]): void {
  const { addToQueue } = useMusicPlayerStore.getState();
  songs.forEach((song) => addToQueue(song));
}
