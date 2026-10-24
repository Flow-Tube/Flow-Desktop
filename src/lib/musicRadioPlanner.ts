import type { SongItem } from "../types/music";

/**
 * The station's suggestion pool, ported from Android's MusicRadioPlanner. The
 * pool is ranked once when tracks arrive and the queue takes from its head, so
 * a top-up never reorders what was already chosen.
 */
export const MAX_POOL_SIZE = 100;

/**
 * Songs one artist may hold in the station at a time. Artist variety is what
 * listeners register as diversity, and two across a hundred-track pool sits
 * well inside what licensed radio allows (four per artist in three hours).
 */
export const MAX_TRACKS_PER_ARTIST = 2;

/** The pool refills from YouTube once it holds fewer tracks than this. */
export const POOL_LOW_WATER = 15;

export const MAX_RADIO_ANCHORS = 8;

const trackId = (track: SongItem): string => track.videoId ?? track.id;

/**
 * The primary artist's browse id, or its lowercased name. A track with no
 * credited artist counts as its own artist, so an unknown credit never caps.
 */
export function primaryArtistKey(track: SongItem): string {
  const primary = track.artists[0];
  if (primary?.id) return primary.id;
  const name = primary?.name?.trim().toLowerCase();
  return name ? name : `track:${trackId(track)}`;
}

export function artistCounts(tracks: SongItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    const key = primaryArtistKey(track);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

const distinctById = (tracks: SongItem[]): SongItem[] => {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    const id = trackId(track);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

/**
 * Drops an artist's surplus tracks, keeping the order it was handed: ranking
 * runs first, so the survivors are that artist's best-placed entries.
 */
function capArtists(tracks: SongItem[], alreadyHeld: Map<string, number>): SongItem[] {
  const counts = new Map(alreadyHeld);
  return tracks.filter((track) => {
    const key = primaryArtistKey(track);
    const held = counts.get(key) ?? 0;
    if (held >= MAX_TRACKS_PER_ARTIST) return false;
    counts.set(key, held + 1);
    return true;
  });
}

/**
 * Grows the pool without disturbing what is already in it, and without letting
 * it run away. `stationTracks` are the station's tracks still waiting in the
 * queue: they count toward each artist's share. Returns `existing` itself when
 * nothing new fits.
 */
export function growPool(
  existing: SongItem[],
  incoming: SongItem[],
  excludedIds: Set<string>,
  stationTracks: SongItem[] = [],
): SongItem[] {
  const room = MAX_POOL_SIZE - existing.length;
  if (room <= 0) return existing;
  const existingIds = new Set(existing.map(trackId));
  const fresh = capArtists(
    distinctById(incoming).filter((t) => !excludedIds.has(trackId(t)) && !existingIds.has(trackId(t))),
    artistCounts([...stationTracks, ...existing]),
  ).slice(0, room);
  return fresh.length === 0 ? existing : [...existing, ...fresh];
}

/** What the queue takes next: the head of the pool, minus anything it already holds. */
export function nextBatch(pool: SongItem[], queueIds: Set<string>, limit: number): SongItem[] {
  return pool.filter((t) => !queueIds.has(trackId(t))).slice(0, limit);
}

/**
 * The tracks a station refills from once YouTube's continuation runs out: the
 * seed and the songs YouTube placed closest to it. Refilling from the newest
 * tail instead chains each mix off the last one, and a few hops later the
 * station has wandered off the seed's genre.
 */
export function radioAnchors(seedId: string, firstPage: SongItem[]): string[] {
  return [...new Set([seedId, ...firstPage.map(trackId)])].slice(0, MAX_RADIO_ANCHORS);
}

export function nextAnchor(anchors: string[], used: Set<string>): string | null {
  return anchors.find((id) => !used.has(id)) ?? null;
}
