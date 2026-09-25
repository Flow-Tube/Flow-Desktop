import { describe, expect, it } from 'vitest';

import { interleaveSimilar, roundRobinReleases, shuffled } from './musicRecall';
import type { AlbumItem, YTItem } from '../types/music';

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

describe('interleaveSimilar', () => {
  const song = (id: string): YTItem => ({
    type: 'song', id, videoId: id, title: id, artists: [], album: null, duration: null,
    musicVideoType: null, thumbnail: '', explicit: false, playlistId: null, params: null,
  });
  const artist = (id: string): YTItem => ({ type: 'artist', id, title: id, thumbnail: null, channelId: null });
  const playlist = (id: string): YTItem => ({
    type: 'playlist', id, title: id, author: null, songCountText: null, thumbnail: null,
  });
  const ids = (items: YTItem[]) => items.map((item) => ('id' in item ? item.id : ''));

  it('starts with two songs, then alternates artist and playlist cards every second song', () => {
    const row = interleaveSimilar(['s1', 's2', 's3', 's4', 's5', 's6'].map(song),
      [[artist('a1'), artist('a2')], [playlist('p1')]]);
    expect(ids(row)).toEqual(['s1', 's2', 'a1', 's3', 's4', 'p1', 's5', 's6', 'a2']);
  });

  it('keeps extra cards when there are few songs', () => {
    expect(ids(interleaveSimilar([song('s1')], [[artist('a1')], [playlist('p1')]]))).toEqual(['s1', 'a1', 'p1']);
  });
});
