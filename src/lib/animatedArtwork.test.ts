import { beforeEach, describe, expect, it, vi } from 'vitest';

const lyricsHttpGet = vi.fn();
vi.mock('./lyrics/http', () => ({
  lyricsHttpGet: (...args: unknown[]) => lyricsHttpGet(...args),
  enc: encodeURIComponent,
}));
vi.mock('../store/useAppSettingsStore', () => ({ getSettingValue: () => 'US' }));
const searchMusicTyped = vi.fn();
vi.mock('./api/music', () => ({ searchMusicTyped: (...args: unknown[]) => searchMusicTyped(...args) }));

import { acceptsAnswer, artworkKey, artworkLoopFor, artworkQueries, forgetArtworkLoop, otherReleases } from './animatedArtwork';
import type { SongItem } from '../types/music';

const song = (patch: Partial<SongItem> = {}): SongItem =>
  ({
    id: 'a',
    videoId: 'a',
    title: 'Blinding Lights (Remastered)',
    artists: [{ name: 'The Weeknd', id: null }],
    album: { name: 'After Hours', id: 'x' },
    duration: 200,
    ...patch,
  }) as SongItem;

const answer = (body: object, status = 200) => ({ status, body: JSON.stringify(body) });

describe('artworkQueries', () => {
  it('asks as titled, then without the extras, each once', () => {
    expect(artworkQueries(song()).map((q) => q.title)).toEqual(['Blinding Lights (Remastered)', 'Blinding Lights']);
    expect(artworkQueries(song({ title: 'Plain' }))).toHaveLength(1);
    expect(artworkQueries(song({ artists: [{ name: 'Band - Topic', id: null }] }))[0]?.artist).toBe('Band');
  });
});

describe('artworkKey', () => {
  it('is shared by the songs of an album', () => {
    expect(artworkKey(song())).toBe(artworkKey(song({ title: 'Another Track' })));
  });
});

describe('acceptsAnswer', () => {
  it('needs the same song by the same artist', () => {
    expect(acceptsAnswer(song({ title: 'Blinding Lights' }), { name: 'blinding lights', artist: 'The Weeknd & Friend' })).toBe(true);
    expect(acceptsAnswer(song({ title: 'Blinding Lights' }), { name: 'Other Song', artist: 'The Weeknd' })).toBe(false);
    expect(acceptsAnswer(song({ title: 'Blinding Lights' }), { name: 'Blinding Lights', artist: 'Someone Else' })).toBe(false);
    expect(acceptsAnswer(song(), {})).toBe(false);
  });
});

describe('artworkLoopFor', () => {
  beforeEach(() => {
    window.localStorage.clear();
    lyricsHttpGet.mockReset();
    searchMusicTyped.mockReset();
  });
  const service = () => lyricsHttpGet.mock.calls.filter(([url]) => String(url).startsWith('https://artwork.boidu.dev/?s='));

  it('tries the plain title, keeps the answer and asks once per album', async () => {
    lyricsHttpGet
      .mockResolvedValueOnce(answer({ name: 'Nope', artist: 'Nope' }))
      .mockResolvedValueOnce(answer({ name: 'Blinding Lights', artist: 'The Weeknd', animated: 'https://x.apple.com/a.m3u8' }));
    await expect(artworkLoopFor(song(), 1000)).resolves.toBe('https://x.apple.com/a.m3u8');
    expect(lyricsHttpGet).toHaveBeenCalledTimes(2);
    expect(lyricsHttpGet.mock.calls[0]?.[0]).toContain('storefront=us');

    await expect(artworkLoopFor(song({ title: 'Another' }), 2000)).resolves.toBe('https://x.apple.com/a.m3u8');
    expect(lyricsHttpGet).toHaveBeenCalledTimes(2);
  });

  it("asks about the song's other releases when the service lands on one with no loop", async () => {
    const yellow = song({ title: 'Yellow', artists: [{ name: 'Coldplay', id: null }], album: { name: 'Parachutes', id: 'p' } });
    lyricsHttpGet.mockImplementation(async (url: string) => {
      if (url.startsWith('https://itunes.apple.com/search')) {
        return answer({
          results: [
            { trackName: 'Yellow', artistName: 'Coldplay', collectionId: 1778462224, collectionName: 'Parachutes', trackCount: 10 },
            { trackName: 'Yellow', artistName: 'Coldplay', collectionId: 1122782080, collectionName: 'Parachutes', trackCount: 10 },
            { trackName: 'Yellow', artistName: 'Coldplay', collectionId: 1005575894, collectionName: 'Relax', collectionArtistName: 'Various Artists' },
          ],
        });
      }
      if (url.includes('id=1122782080')) return answer({ name: 'Yellow', artist: 'Coldplay', animated: 'loop' });
      return answer({ name: 'Yellow', artist: 'Coldplay', albumId: '1778462224', animated: null });
    });
    await expect(artworkLoopFor(yellow, 0)).resolves.toBe('loop');
    expect(lyricsHttpGet.mock.calls.some(([url]) => String(url).includes('id=1778462224'))).toBe(false);
  });

  it('asks a row with no album again under its song version, and reads Unknown Album as none', async () => {
    searchMusicTyped.mockResolvedValue({
      sections: [{ items: [{ type: 'song', title: 'Plain', artists: [{ name: 'The Weeknd', id: null }], album: { name: 'Real Album', id: 'r' }, musicVideoType: 'MUSIC_VIDEO_TYPE_ATV', duration: 201 }] }],
    });
    lyricsHttpGet.mockImplementation(async (url: string) => {
      if (url.startsWith('https://itunes.apple.com/search')) return answer({ results: [] });
      if (url.includes('al=Real')) return answer({ name: 'Plain', artist: 'The Weeknd', animated: 'version-loop' });
      return answer({ name: 'Plain', artist: 'The Weeknd' });
    });
    const video = song({ title: 'Plain', album: { name: 'Unknown Album', id: '' } });
    await expect(artworkLoopFor(video, 0)).resolves.toBe('version-loop');
    expect(service()[0]?.[0]).not.toContain('al=');
  });

  it('remembers none for days, then asks again', async () => {
    lyricsHttpGet.mockImplementation(async (url: string) =>
      url.startsWith('https://itunes.apple.com/search') ? answer({ results: [] }) : answer({ name: 'Nope', artist: 'Nope' }),
    );
    const plain = song({ title: 'Plain' });
    await expect(artworkLoopFor(plain, 0)).resolves.toBeNull();
    await expect(artworkLoopFor(plain, 1000)).resolves.toBeNull();
    expect(service()).toHaveLength(1);
    await artworkLoopFor(plain, 4 * 24 * 60 * 60 * 1000);
    expect(service()).toHaveLength(2);
  });

  it('throws when the service fails and keeps nothing', async () => {
    lyricsHttpGet.mockResolvedValueOnce(answer({}, 500));
    await expect(artworkLoopFor(song(), 0)).rejects.toThrow('500');
    lyricsHttpGet.mockResolvedValue(answer({ name: 'Blinding Lights', artist: 'The Weeknd', animated: 'u' }));
    await expect(artworkLoopFor(song(), 1)).resolves.toBe('u');
  });

  it('forgets a loop that no longer plays', async () => {
    lyricsHttpGet.mockResolvedValue(answer({ name: 'Blinding Lights', artist: 'The Weeknd', animated: 'u' }));
    await artworkLoopFor(song(), 0);
    forgetArtworkLoop(song());
    await artworkLoopFor(song(), 1);
    expect(lyricsHttpGet.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('otherReleases', () => {
  it('takes only releases named like the song or its album, albums before singles, no compilations or remixes', () => {
    const yellow = song({ title: 'Yellow', artists: [{ name: 'Coldplay', id: null }], album: { name: 'Parachutes', id: 'p' } });
    const ids = otherReleases(
      yellow,
      [
        { trackName: 'Yellow', artistName: 'Coldplay', collectionId: 1, collectionName: 'Yellow - Single', trackCount: 3 },
        { trackName: 'Yellow', artistName: 'Coldplay', collectionId: 2, collectionName: 'Parachutes', trackCount: 10 },
        { trackName: 'Yellow', artistName: 'Coldplay', collectionId: 3, collectionName: 'Yellow (Remix)', trackCount: 2 },
        { trackName: 'Yellow', artistName: 'Coldplay', collectionId: 4, collectionName: 'Chill Hits', collectionArtistName: 'Various Artists' },
        { trackName: 'Fix You', artistName: 'Coldplay', collectionId: 5, collectionName: 'X&Y' },
      ],
      new Set(['9']),
    );
    expect(ids).toEqual(['2', '1']);
  });
});
