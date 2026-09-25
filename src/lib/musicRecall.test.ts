import { describe, expect, it } from 'vitest';

import { roundRobinReleases, shuffled } from './musicRecall';
import type { AlbumItem } from '../types/music';

describe('shuffled', () => {
  it('permutes without losing or duplicating items', () => {
    const items = Array.from({ length: 20 }, (_, index) => index);
    const out = shuffled(items);
    expect([...out].sort((a, b) => a - b)).toEqual(items);
    expect(items).toEqual(Array.from({ length: 20 }, (_, index) => index));
  });

  it('is a Fisher–Yates walk driven by the random source', () => {
    expect(shuffled([1, 2, 3], () => 0)).toEqual([2, 3, 1]);
  });
});

describe('roundRobinReleases', () => {
  const album = (id: string): AlbumItem => ({
    browseId: id, playlistId: '', title: id, artists: null, year: null, thumbnail: '', explicit: false,
  });

  it('takes one release per artist per pass and drops repeats', () => {
    const out = roundRobinReleases([[album('a1'), album('a2')], [album('b1'), album('a1')], [album('c1')]], 4);
    expect(out.map((item) => item.browseId)).toEqual(['a1', 'b1', 'c1', 'a2']);
  });
});
