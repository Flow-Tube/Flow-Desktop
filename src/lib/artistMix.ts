import { getMusicWatchQueue } from './api/music';
import type { MusicWatchTarget, SongItem } from '../types/music';

/**
 * The queue an artist header's Shuffle or Radio starts: the site's own, 50 tracks of the
 * artist's catalogue or station, rather than a reshuffle of the few top songs on the page.
 */
export async function artistMixQueue(target: MusicWatchTarget): Promise<SongItem[]> {
  const page = await getMusicWatchQueue(undefined, target.playlistId, target.params ?? undefined);
  return page.items;
}
