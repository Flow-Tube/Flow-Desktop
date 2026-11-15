import type { SongItem, YTItem } from "../../types/music";
import type { AiListMatcher } from "./matcher";

/** The channel ids a music item credits, which the AI filter checks: artists of songs and albums, a playlist's author. */
export function aiCreditedIds(item: YTItem): string[] {
  switch (item.type) {
    case "song":
      return item.artists.map((artist) => artist.id).filter((id): id is string => !!id);
    case "album":
      return (item.artists ?? []).map((artist) => artist.id).filter((id): id is string => !!id);
    case "playlist":
      return item.author?.id ? [item.author.id] : [];
    default:
      return [];
  }
}

/** A song the AI filter hides, for radio and other places that hold songs rather than items. */
export function aiHidesSong(matcher: AiListMatcher, song: SongItem): boolean {
  return matcher.isMusicActive && matcher.musicVerdict(song.artists.map((artist) => artist.id)) === "block";
}

/**
 * A Home or recommendation item the AI filter hides. Unlike search, artist cards go too: Home
 * recommends them, while search lets a listed artist be found on purpose.
 */
export function aiHidesRecommended(matcher: AiListMatcher, item: YTItem): boolean {
  if (!matcher.isMusicActive) return false;
  const ids = item.type === "artist" ? [item.id] : aiCreditedIds(item);
  return matcher.musicVerdict(ids) === "block";
}

/** Search items without AI music; artist cards stay. The same array comes back when nothing goes. */
export function withoutAiMusic<T extends YTItem>(items: T[], matcher: AiListMatcher): T[] {
  if (!matcher.isMusicActive) return items;
  const kept = items.filter((item) => matcher.musicVerdict(aiCreditedIds(item)) !== "block");
  return kept.length === items.length ? items : kept;
}
