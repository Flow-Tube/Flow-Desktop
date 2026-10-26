import { showSaveFailedToast, showSaveToast, type SavedItem } from "./saveToast";
import { useLikesStore } from "../store/useLikesStore";
import type { SongItem } from "../types/music";

export function songToastItem(song: SongItem): SavedItem {
  const artists = song.artists.map((artist) => artist.name).filter(Boolean).join(", ");
  return {
    title: artists ? `${song.title} · ${artists}` : song.title,
    image: song.thumbnail,
    shape: "square",
  };
}

/** Likes or unlikes a song and says so with its cover, offering Undo. */
export async function toggleSongLikeWithToast(song: SongItem, wasLiked: boolean): Promise<void> {
  const { toggleSong } = useLikesStore.getState();
  const item = songToastItem(song);
  try {
    const nowLiked = await toggleSong(song);
    showSaveToast({
      destination: { kind: "likes" },
      item,
      removed: !nowLiked,
      undo: () => toggleSong(song),
    });
  } catch (error) {
    console.warn("Failed to update song like", error);
    showSaveFailedToast({
      destination: { kind: "likes" },
      item,
      removed: wasLiked,
      retry: () => toggleSongLikeWithToast(song, wasLiked),
    });
  }
}
