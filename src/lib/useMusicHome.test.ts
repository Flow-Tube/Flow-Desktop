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

import { MUSIC_HOME_CACHE_FRESH_MS, useMusicHome } from './useMusicHome';

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

  it('refetches the first page when a cached continuation has expired', async () => {
    api.getCachedMusicHomePage.mockResolvedValue(cached(['Cached'], 60_000, 'expired'));
    api.getMusicHomePage
      .mockRejectedValueOnce(new Error('bad continuation'))
      .mockResolvedValueOnce(page(['Live'], 'live-token'));
    await renderHome();
    await act(async () => { await state.current?.loadMore(); });
    expect(api.getMusicHomePage).toHaveBeenNthCalledWith(1, 'expired');
    expect(api.getMusicHomePage).toHaveBeenNthCalledWith(2);
    expect(titles()).toEqual(['Live']);
    expect(state.current?.loadMoreError).toBeNull();
  });
});
