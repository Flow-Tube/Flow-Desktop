import { favouriteMusicArtist, searchMusicTyped } from './api/music';
import { getScrobbleTopArtists, type ScrobbleService } from './api/scrobble';
import { inChunks, matchKey } from './lastFmDiscovery';
import type { ArtistItem, YTItem } from '../types/music';

const TOP_ARTISTS = 20;
const PARALLEL_SEARCHES = 4;

/** The artist with exactly this name on YouTube Music; a near match is skipped rather than guessed. */
async function matchingArtist(name: string): Promise<ArtistItem | null> {
  const wanted = matchKey(name);
  const found = await searchMusicTyped(name, 'artists').catch(() => null);
  const artists = (found?.sections.flatMap((section) => section.items) ?? []).filter(
    (item: YTItem): item is Extract<YTItem, { type: 'artist' }> => item.type === 'artist',
  );
  return artists.find((artist) => matchKey(artist.title) === wanted) ?? null;
}

/**
 * Turns an account's most played artists into favourite artists, so the music recommendations start
 * from years of real listening. Returns how many were added; ones already favourites don't count.
 */
export async function importTopArtists(service: ScrobbleService): Promise<number> {
  const names = await getScrobbleTopArtists(service, TOP_ARTISTS);
  const found = await inChunks(names, PARALLEL_SEARCHES, matchingArtist);
  const unique = new Map(found.filter((artist): artist is ArtistItem => !!artist).map((artist) => [artist.id, artist]));
  const added = await Promise.all(
    [...unique.values()].map((artist) => favouriteMusicArtist(artist.id, artist.title).catch(() => false)),
  );
  return added.filter(Boolean).length;
}
