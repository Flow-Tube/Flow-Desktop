import { useCallback } from "react";
import { searchMusicTyped } from "./api/music";
import { getString } from "./i18n/index";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { useUiStore } from "../store/useUiStore";
import type { SongItem, YTItem } from "../types/music";
import type { DescriptionExtras } from "../types/video";

type MusicCard = DescriptionExtras["music"][number];

const isSong = (item: YTItem): item is { type: "song" } & SongItem => item.type === "song";

/**
 * Plays a song credited in a video's description in the music player. The card names the song
 * but carries no id, so the top YouTube Music match for its title and artist is played.
 */
export function usePlayMusicCard(): (card: MusicCard) => Promise<void> {
  return useCallback(async (card: MusicCard) => {
    const notFound = () =>
      useUiStore.getState().showToast({ message: getString("description_song_not_found"), variant: "error" });
    try {
      const results = await searchMusicTyped([card.title, card.artist].filter(Boolean).join(" "), "songs");
      const song = results.sections.flatMap((section) => section.items).find(isSong);
      if (!song) {
        notFound();
        return;
      }
      await useMusicPlayerStore.getState().playTrack(song);
    } catch (error) {
      console.warn("Could not play the credited song", error);
      notFound();
    }
  }, []);
}
