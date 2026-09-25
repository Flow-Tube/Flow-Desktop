import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChartsPage, SongItem } from '../types/music';

const api = vi.hoisted(() => ({
  getMusicChartsPage: vi.fn(),
  getMusicArtistPage: vi.fn(),
  getMusicRelatedTyped: vi.fn(),
  getMusicWatchQueue: vi.fn(),
  getMusicQueueContinuation: vi.fn(),
  rankMusicCandidates: vi.fn(async (songs: SongItem[]) => songs),
}));
vi.mock('./api/music', () => api);
vi.mock('../store/useLikesStore', () => ({
  useLikesStore: { getState: () => ({ load: async () => undefined, items: [] }) },
}));

import { buildQuickPicks } from './musicQuickPicksBuilder';

const chartSong = (index: number): SongItem => ({
  id: `chart-${index}`, videoId: `chart-${index}`, title: `Chart ${index}`,
  artists: [{ name: `Artist ${index}`, id: `artist-${index}` }], album: null, duration: 200,
  musicVideoType: 'MUSIC_VIDEO_TYPE_ATV', thumbnail: '', explicit: false, playlistId: null, params: null,
});
const charts = (count: number): ChartsPage => ({
  sections: [{ title: 'Top songs', chartType: 'Songs',
    items: Array.from({ length: count }, (_, index) => ({ type: 'song' as const, ...chartSong(index) })) }],
  countryCode: 'US', countryLabel: 'United States', continuation: null,
});

describe('buildQuickPicks on a first run', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lets charts fill the shelf when there are no personal lanes', async () => {
    api.getMusicChartsPage.mockResolvedValue(charts(10));
    const picks = await buildQuickPicks([], null, new Set(), null);
    expect(picks).toHaveLength(10);
  });

  it('hides a shelf too small to be useful', async () => {
    api.getMusicChartsPage.mockResolvedValue(charts(3));
    expect(await buildQuickPicks([], null, new Set(), null)).toEqual([]);
  });
});
