import { beforeEach, describe, expect, it, vi } from 'vitest';

const lyricsHttpGet = vi.fn();
vi.mock('./lyrics/http', () => ({
  lyricsHttpGet: (...args: unknown[]) => lyricsHttpGet(...args),
  enc: encodeURIComponent,
}));
vi.mock('../store/useAppSettingsStore', () => ({ getSettingValue: () => 'US' }));

import { acceptsAnswer, artworkKey, artworkLoopFor, artworkQueries, forgetArtworkLoop } from './animatedArtwork';
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
  });

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

  it('remembers none for days, then asks again', async () => {
    lyricsHttpGet.mockResolvedValue(answer({ name: 'Nope', artist: 'Nope' }));
    const plain = song({ title: 'Plain' });
    await expect(artworkLoopFor(plain, 0)).resolves.toBeNull();
    await expect(artworkLoopFor(plain, 1000)).resolves.toBeNull();
    expect(lyricsHttpGet).toHaveBeenCalledTimes(1);
    await artworkLoopFor(plain, 4 * 24 * 60 * 60 * 1000);
    expect(lyricsHttpGet).toHaveBeenCalledTimes(2);
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
