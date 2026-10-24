import type { SongItem, YTItem } from "../types/music";
import { searchMusicTyped } from "./api/music";
import { pickOfficialVideo } from "./musicVideoMatching";

const isSong = (item: YTItem): item is Extract<YTItem, { type: "song" }> => item.type === "song";

/** The song's official music video, found through a YouTube Music video search; null when it has none. */
export async function findOfficialVideo(song: SongItem): Promise<SongItem | null> {
  const artist = song.artists[0]?.name ?? "";
  const response = await searchMusicTyped(`${artist} ${song.title}`.trim(), "videos");
  const candidates = response.sections.flatMap((section) => section.items).filter(isSong);
  return pickOfficialVideo(song, candidates);
}
