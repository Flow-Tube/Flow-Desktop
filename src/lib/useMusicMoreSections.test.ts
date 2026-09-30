import { describe, expect, it } from 'vitest';

import { chooseGenres, popularArtistsFrom } from './useMusicMoreSections';
import type { SongItem } from '../types/music';

const song = (id: string, artistId: string | null, name = artistId ?? 'Unknown'): SongItem => ({
  id, videoId: id, title: id, artists: [{ id: artistId, name }], album: null, duration: 200,
  musicVideoType: 'MUSIC_VIDEO_TYPE_ATV', thumbnail: `${id}.jpg`, explicit: false, playlistId: null, params: null,
});

describe('popularArtistsFrom', () => {
  it('takes one artist per trending song in chart order, with the song cover', () => {
    const artists = popularArtistsFrom(
      [song('s1', 'UCa', 'A'), song('s2', 'UCa', 'A'), song('s3', null), song('s4', 'UCb', 'B')], 10,
    );
    expect(artists.map((artist) => artist.id)).toEqual(['UCa', 'UCb']);
    expect(artists[0]?.thumbnail).toBe('s1.jpg');
  });
});

describe('chooseGenres', () => {
  const genre = (title: string) => ({ title, browseId: title });

  it('prefers the mainstream genres YouTube offers, then fills from the rest', () => {
    const picked = chooseGenres([genre('Arabic'), genre('Rock'), genre('Blues'), genre('Pop')], 3);
    expect(picked.slice(0, 2).map((item) => item.title)).toEqual(['Pop', 'Rock']);
    expect(picked).toHaveLength(3);
  });

  it('works when none of the preferred genres exist', () => {
    expect(chooseGenres([genre('Arabic'), genre('Blues')], 3)).toHaveLength(2);
  });
});
