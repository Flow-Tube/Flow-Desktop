import { beforeEach, describe, expect, it, vi } from 'vitest';

const favouriteMusicArtist = vi.fn();
const searchMusicTyped = vi.fn();
const getScrobbleTopArtists = vi.fn();
vi.mock('./api/music', () => ({
  favouriteMusicArtist: (...args: unknown[]) => favouriteMusicArtist(...args),
  searchMusicTyped: (...args: unknown[]) => searchMusicTyped(...args),
  getHeavyRotation: vi.fn(),
}));
vi.mock('./api/scrobble', () => ({
  getScrobbleTopArtists: (...args: unknown[]) => getScrobbleTopArtists(...args),
  getScrobbleSimilarTracks: vi.fn(),
}));

import { importTopArtists } from './scrobbleTasteImport';

const artist = (id: string, title: string) => ({ type: 'artist', id, title, thumbnail: null, channelId: null });

describe('importTopArtists', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds exact name matches only and counts the new ones', async () => {
    getScrobbleTopArtists.mockResolvedValue(['Beyoncé', 'Near', 'Known']);
    searchMusicTyped.mockImplementation(async (name: string) => ({
      sections: [{
        items: name === 'Beyoncé' ? [artist('b', 'BEYONCE')] : name === 'Near' ? [artist('n', 'Nearly')] : [artist('k', 'known')],
      }],
    }));
    favouriteMusicArtist.mockImplementation(async (id: string) => id === 'b');

    expect(await importTopArtists('LASTFM')).toBe(1);
    expect(favouriteMusicArtist.mock.calls.map((call) => call[0])).toEqual(['b', 'k']);
    expect(getScrobbleTopArtists).toHaveBeenCalledWith('LASTFM', 20);
  });

  it('passes on a failure to read the account', async () => {
    getScrobbleTopArtists.mockRejectedValue(new Error('down'));
    await expect(importTopArtists('LISTENBRAINZ')).rejects.toThrow('down');
  });
});
