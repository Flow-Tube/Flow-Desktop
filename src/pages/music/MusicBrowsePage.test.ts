import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { YTItem } from '../../types/music';

const chip = vi.hoisted(() => ({ items: [] as YTItem[] }));
vi.mock('../../lib/useMusicHome', () => ({
  useMusicChipFilter: () => ({
    items: chip.items,
    sections: [],
    loading: false,
    loadingMore: false,
    error: null,
    reload: vi.fn(),
    loadMore: vi.fn(),
    hasMore: false,
  }),
}));

import MusicBrowsePage from './MusicBrowsePage';
import { useMusicPlayerStore } from '../../store/useMusicPlayerStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const episode: YTItem = {
  type: 'episode',
  id: 'ep_test_01',
  title: 'Living Your Best Life',
  author: { name: 'Huberman Lab', id: null },
  podcastId: 'PL12345',
  thumbnail: 'https://example.com/ep.jpg',
  explicit: false,
  publishDateText: '2d ago',
};
const podcast: YTItem = {
  type: 'podcast',
  id: 'PL12345',
  title: 'Huberman Lab',
  author: null,
  episodeCountText: null,
  thumbnail: null,
};

let host: HTMLDivElement;
let root: Root;

const playQueue = vi.fn(async () => undefined);

/** Cards in the order the page shows them. */
const cards = () => Array.from(host.querySelectorAll<HTMLElement>('[role="button"]'));

describe('MusicBrowsePage', () => {
  beforeEach(() => {
    chip.items = [episode, podcast];
    playQueue.mockClear();
    useMusicPlayerStore.setState({ playQueue } as never);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root.render(createElement(MemoryRouter, { initialEntries: ['/music/browse?browseId=FEmusic_home&params=x&title=Podcasts'] },
        createElement(Routes, null,
          createElement(Route, { path: '/music/browse', element: createElement(MusicBrowsePage) }),
          createElement(Route, { path: '/music/playlist/:id', element: createElement('p', null, 'playlist page') }))));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('plays an episode as a song in the music player', () => {
    expect(cards().map((element) => element.textContent)).toEqual([
      expect.stringContaining('Living Your Best Life'),
      expect.stringContaining('Huberman Lab'),
    ]);
    act(() => cards()[0]?.click());
    expect(playQueue).toHaveBeenCalledOnce();
    const [queue, index] = playQueue.mock.calls[0] as unknown as [{ videoId: string }[], number];
    expect(queue.map((song) => song.videoId)).toEqual(['ep_test_01']);
    expect(index).toBe(0);
  });

  it('opens a podcast show as its playlist', () => {
    act(() => cards()[1]?.click());
    expect(host.textContent).toContain('playlist page');
  });
});
