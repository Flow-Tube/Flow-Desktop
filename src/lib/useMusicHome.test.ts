import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CachedMusicHomePage, MusicHomePage, MusicShelf } from '../types/music';

const api = vi.hoisted(() => ({
  getCachedMusicHomePage: vi.fn(),
  getMusicHomePage: vi.fn(),
  getMusicNewReleases: vi.fn(),
  getMusicMoodGenre: vi.fn(),
}));
vi.mock('./api/music', () => api);

import { MUSIC_HOME_CACHE_FRESH_MS, useMusicChipFilter, useMusicHome } from './useMusicHome';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const shelf = (title: string): MusicShelf => ({ title, subtitle: null, browseId: null, params: null, items: [] });
const page = (titles: string[], continuation: string | null = null): MusicHomePage => ({
  chips: [], sections: titles.map(shelf), continuation,
});
const cached = (titles: string[], ageMs: number, continuation: string | null = null): CachedMusicHomePage => ({
  page: page(titles, continuation), fetchedAt: Math.floor((Date.now() - ageMs) / 1000),
});

type HomeState = ReturnType<typeof useMusicHome>;
let root: Root | null = null;
const state: { current: HomeState | null } = { current: null };

async function renderHome() {
  function Probe() {
    state.current = useMusicHome();
    return null;
  }
  root = createRoot(document.createElement('div'));
  await act(async () => { root?.render(createElement(Probe)); });
  await act(async () => { await Promise.resolve(); });
}

const titles = () => state.current?.data?.sections.map((section) => section.title);

describe('useMusicHome', () => {
  beforeEach(() => {
    api.getMusicNewReleases.mockResolvedValue([]);
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    root = null;
    state.current = null;
    vi.clearAllMocks();
  });

  it('paints a fresh cache without any network request', async () => {
    api.getCachedMusicHomePage.mockResolvedValue(cached(['Cached'], 60_000));
    await renderHome();
    expect(titles()).toEqual(['Cached']);
    expect(api.getMusicHomePage).not.toHaveBeenCalled();
  });

  it('paints a stale cache first, then replaces it with the network page', async () => {
    api.getCachedMusicHomePage.mockResolvedValue(cached(['Old'], MUSIC_HOME_CACHE_FRESH_MS + 1));
    api.getMusicHomePage.mockResolvedValue(page(['Fresh']));
    await renderHome();
    expect(api.getMusicHomePage).toHaveBeenCalledTimes(1);
    expect(titles()).toEqual(['Fresh']);
    expect(state.current?.error).toBeNull();
  });

  it('keeps the last good page when the refresh fails', async () => {
    api.getCachedMusicHomePage.mockResolvedValue(cached(['Old'], MUSIC_HOME_CACHE_FRESH_MS + 1));
    api.getMusicHomePage.mockRejectedValue(new Error('offline'));
    await renderHome();
    expect(titles()).toEqual(['Old']);
    expect(state.current?.error).toBeTruthy();
  });

  it('loads the next two pages in the background after the first one shows', async () => {
    api.getCachedMusicHomePage.mockResolvedValue(null);
    api.getMusicHomePage
      .mockResolvedValueOnce(page(['First'], 'p1'))
      .mockResolvedValueOnce(page(['Second'], 'p2'))
      .mockResolvedValueOnce(page(['Third'], 'p3'));
    await renderHome();
    await act(async () => { await Promise.resolve(); });
    expect(api.getMusicHomePage).toHaveBeenNthCalledWith(2, 'p1');
    expect(api.getMusicHomePage).toHaveBeenNthCalledWith(3, 'p2');
    expect(api.getMusicHomePage).toHaveBeenCalledTimes(3);
    expect(titles()).toEqual(['First', 'Second', 'Third']);
  });

  it('refetches the first page when a cached continuation has expired', async () => {
    api.getCachedMusicHomePage.mockResolvedValue(cached(['Cached'], 60_000, 'expired'));
    api.getMusicHomePage
      .mockRejectedValueOnce(new Error('bad continuation'))
      .mockResolvedValueOnce(page(['Live'], 'live-token'))
      .mockResolvedValue(page(['More']));
    await renderHome();
    await act(async () => { await Promise.resolve(); });
    expect(api.getMusicHomePage).toHaveBeenNthCalledWith(1, 'expired');
    expect(api.getMusicHomePage).toHaveBeenNthCalledWith(2);
    expect(api.getMusicHomePage).toHaveBeenNthCalledWith(3, 'live-token');
    expect(titles()).toEqual(['Live', 'More']);
    expect(state.current?.loadMoreError).toBeNull();
  });
});

describe('useMusicChipFilter', () => {
  it('loads items for a chip filter including podcast episodes', async () => {
    const chipState: { current: ReturnType<typeof useMusicChipFilter> | null } = { current: null };
    function ChipProbe() {
      chipState.current = useMusicChipFilter({
        title: 'Podcasts',
        browseId: 'FEmusic_home',
        params: 'ggMPOg1uZXdfcG9kY2FzdHM%3D',
        orderBy: 0,
      });
      return null;
    }
    api.getMusicMoodGenre.mockResolvedValueOnce({
      items: [
        {
          type: 'episode',
          id: 'ep1',
          title: 'Ep 1',
          author: { name: 'Show', id: null },
          podcastId: 'PL1',
          thumbnail: 'thumb.jpg',
          explicit: false,
          publishDateText: '1d ago',
        },
      ],
      sections: [],
      continuation: null,
    });

    const chipRoot = createRoot(document.createElement('div'));
    await act(async () => {
      chipRoot.render(createElement(ChipProbe));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(chipState.current?.items).toHaveLength(1);
    expect(chipState.current?.items[0]?.type).toBe('episode');

    await act(async () => {
      chipRoot.unmount();
    });
  });
});
