import { getMusicArtistPage } from './api/music';
import { artistMixQueue } from './artistMix';
import type { SongItem } from '../types/music';

/**
 * The queue an artist's Shuffle or Radio starts from a search result. A search card carries no
 * queue of its own, so the artist page (usually cached) supplies the same one its header plays.
 * Empty when the artist has none, so the caller can open the artist page instead.
 */
export async function artistTopResultMix(artistId: string, kind: 'shuffle' | 'radio'): Promise<SongItem[]> {
  const page = await getMusicArtistPage(artistId, { preferCached: true });
  const target = kind === 'shuffle' ? page.shuffle : page.radio;
  return target ? artistMixQueue(target) : [];
}
