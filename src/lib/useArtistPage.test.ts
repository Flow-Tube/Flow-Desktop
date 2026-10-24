import { describe, expect, it } from 'vitest';
import { segmentArtistPage } from './useArtistPage';
import type { ArtistPage, ArtistSection, YTItem } from '../types/music';

const song = (id: string): YTItem => ({
  type: 'song', id, title: id, artists: [], album: null, duration: null, musicVideoType: null,
  thumbnail: '', explicit: false, videoId: id, playlistId: null, params: null,
});
const album = (id: string): YTItem => ({
  type: 'album', browseId: id, playlistId: '', title: id, artists: null, year: null, thumbnail: '', explicit: false,
});
const section = (kind: ArtistSection['kind'], title: string, items: YTItem[]): ArtistSection => ({
  title, items, moreEndpointBrowseId: null, moreEndpointParams: null, kind,
});

describe('segmentArtistPage', () => {
  it('sorts sections by their kind whatever their titles say', () => {
    const page: ArtistPage = {
      artist: { id: 'UC1', title: 'A', thumbnail: null, channelId: 'UC1' },
      sections: [
        section('topSongs', 'Titres', [song('s1')]),
        section('singles', 'Albums & more', [album('single1')]),
        section('albums', 'Discographie', [album('album1')]),
      ],
      description: 'Bio from Wikipedia',
      descriptionLinks: [{ start: 9, end: 18, url: 'https://en.wikipedia.org/wiki/A' }],
      shuffle: { playlistId: 'RDAO1', params: 'wAEB8gECGAE%3D' },
      subscriberCountText: null,
      monthlyListenerCount: null,
      isSubscribed: false,
    };
    const data = segmentArtistPage(page);
    expect(data.topSongs.map((s) => s.id)).toEqual(['s1']);
    expect(data.albums.map((a) => a.browseId)).toEqual(['album1']);
    expect(data.singles.map((a) => a.browseId)).toEqual(['single1']);
    expect(data.aboutLinks).toEqual([{ label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/A' }]);
    expect(data.shuffle?.playlistId).toBe('RDAO1');
    expect(data.radio).toBeNull();
  });
});
