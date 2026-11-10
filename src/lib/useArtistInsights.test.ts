import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

const getMusicArtistInsights = vi.fn();
vi.mock('./api/music', () => ({
  getMusicArtistInsights: (...args: unknown[]) => getMusicArtistInsights(...args),
}));

import { artistListeningLine, useArtistInsights } from './useArtistInsights';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('artistListeningLine', () => {
  it('counts plays and says when you liked them', () => {
    expect(artistListeningLine({ plays: 1, liked: false })).toBe('Played 1 time');
    expect(artistListeningLine({ plays: 12, liked: true })).toBe('Played 12 times · Liked');
  });
});

describe('useArtistInsights', () => {
  function render(id: string | null, name: string | undefined) {
    const seen: unknown[] = [];
    const Probe = () => {
      seen.push(useArtistInsights(id, name));
      return null;
    };
    const root = createRoot(document.createElement('div'));
    return { seen, mount: () => act(async () => root.render(createElement(Probe))) };
  }

  it('asks only once the artist has a name, and gives what the backend says', async () => {
    getMusicArtistInsights.mockResolvedValue({ plays: 3, liked: false, topTracks: [] });
    const nameless = render('UC', undefined);
    await nameless.mount();
    expect(getMusicArtistInsights).not.toHaveBeenCalled();

    const named = render('UC', 'Artist');
    await named.mount();
    expect(getMusicArtistInsights).toHaveBeenCalledWith('UC', 'Artist');
    expect(named.seen[named.seen.length - 1]).toEqual({ plays: 3, liked: false, topTracks: [] });
  });

  it('stays empty when the call fails', async () => {
    getMusicArtistInsights.mockRejectedValue(new Error('down'));
    const failing = render('UC', 'Artist');
    await failing.mount();
    expect(failing.seen[failing.seen.length - 1]).toBeNull();
  });
});
