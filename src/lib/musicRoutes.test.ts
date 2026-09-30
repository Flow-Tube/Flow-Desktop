import { describe, expect, it } from 'vitest';

import { musicSeeAllRoute } from './musicRoutes';
import type { YTItem } from '../types/music';

const song: YTItem = {
  type: 'song', id: 's', videoId: 's', title: 's', artists: [], album: null, duration: null,
  musicVideoType: null, thumbnail: '', explicit: false, playlistId: null, params: null,
};

describe('musicSeeAllRoute', () => {
  it('routes page types to their dedicated pages', () => {
    expect(musicSeeAllRoute('MPREb_album', null, 'Album')).toBe('/music/album/MPREb_album');
    expect(musicSeeAllRoute('VLPLlist', null, 'List')).toBe('/music/playlist/PLlist');
    expect(musicSeeAllRoute('UCartist', null, 'Artist')).toBe('/music/artist/UCartist');
  });

  it('keeps artist sub-lists on the artist items page with the right kind', () => {
    const route = musicSeeAllRoute('UCartist', 'p', 'Songs', [song]);
    expect(route.startsWith('/music/artist/UCartist/items?')).toBe(true);
    expect(new URLSearchParams(route.split('?')[1]).get('kind')).toBe('songs');
  });

  it('sends other browse endpoints to the generic grid', () => {
    const route = musicSeeAllRoute('FEmusic_moods_and_genres_category', 'x', 'Chill');
    expect(route).toBe('/music/browse?browseId=FEmusic_moods_and_genres_category&params=x&title=Chill');
  });
});
