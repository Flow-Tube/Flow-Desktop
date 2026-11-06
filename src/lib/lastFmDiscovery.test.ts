import { beforeEach, describe, expect, it, vi } from 'vitest';

const getHeavyRotation = vi.fn();
const searchMusicTyped = vi.fn();
const getScrobbleSimilarTracks = vi.fn();
vi.mock('./api/music', () => ({
  getHeavyRotation: (...args: unknown[]) => getHeavyRotation(...args),
  searchMusicTyped: (...args: unknown[]) => searchMusicTyped(...args),
}));
vi.mock('./api/scrobble', () => ({
  getScrobbleSimilarTracks: (...args: unknown[]) => getScrobbleSimilarTracks(...args),
}));

import { clearLastFmDiscoveryCache, discoveryPicks, inChunks, lastFmDiscoverySongs, matchKey } from './lastFmDiscovery';

const pair = (artist: string, title: string) => ({ artist, title });
const song = (id: string, artist: string) => ({
  type: 'song', id, videoId: id, title: id, artists: [{ name: artist, id: null }], musicVideoType: 'MUSIC_VIDEO_TYPE_ATV',
});

describe('matchKey', () => {
  it('ignores case, accents and spacing', () => {
    expect(matchKey('  Beyoncé   Knowles ')).toBe(matchKey('BEYONCE KNOWLES'));
  });
});

describe('discoveryPicks', () => {
  it('takes from each seed in turn and skips the seeds and repeats', () => {
    const picks = discoveryPicks(
      [[pair('A', 'one'), pair('A', 'two')], [pair('b', 'x'), pair('A', 'ONE')]],
      [pair('A', 'two')],
      10,
    );
    expect(picks).toEqual([pair('A', 'one'), pair('b', 'x')]);
  });

  it('stops at the limit', () => {
    expect(discoveryPicks([[pair('a', '1'), pair('a', '2'), pair('a', '3')]], [], 2)).toHaveLength(2);
  });
});

describe('inChunks', () => {
  it('never runs more than a chunk at once and keeps the order', async () => {
    let running = 0;
    let peak = 0;
    const out = await inChunks([1, 2, 3, 4, 5], 2, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('lastFmDiscoverySongs', () => {
  beforeEach(() => {
    clearLastFmDiscoveryCache();
    vi.clearAllMocks();
    getHeavyRotation.mockResolvedValue([{ id: 's', videoId: 's', title: 'Seed', artists: [{ name: 'Seed Artist' }] }]);
  });

  it('keeps a song only when its artist matches, and caches while the seeds stay', async () => {
    getScrobbleSimilarTracks.mockResolvedValue([pair('Good', 'One'), pair('Nope', 'Two')]);
    searchMusicTyped.mockImplementation(async (query: string) => ({
      sections: [{ items: query.startsWith('Good') ? [song('g', 'good')] : [song('w', 'Somebody Else')] }],
    }));
    const first = await lastFmDiscoverySongs(1000);
    expect(first.map((s) => s.id)).toEqual(['g']);
    await lastFmDiscoverySongs(2000);
    expect(getScrobbleSimilarTracks).toHaveBeenCalledTimes(1);
  });

  it('asks nothing when nothing is on repeat, and a failed seed only loses that seed', async () => {
    getHeavyRotation.mockResolvedValueOnce([]);
    expect(await lastFmDiscoverySongs()).toEqual([]);
    expect(getScrobbleSimilarTracks).not.toHaveBeenCalled();

    getScrobbleSimilarTracks.mockRejectedValue(new Error('down'));
    expect(await lastFmDiscoverySongs()).toEqual([]);
  });
});
