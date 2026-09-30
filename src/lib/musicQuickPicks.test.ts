import { describe, expect, it } from 'vitest';

import type { WatchHistoryRecord } from '../types/db';
import type { SongItem } from '../types/music';
import { interleaveQuickPickLanes, pickFanArtists, selectQuickPickSeeds } from './musicQuickPicks';

const song = (id: string, artist = id): SongItem => ({
  id,
  title: id,
  artists: [{ id: artist, name: artist }],
  album: null,
  duration: 180,
  musicVideoType: 'MUSIC_VIDEO_TYPE_ATV',
  thumbnail: '',
  explicit: false,
  videoId: id,
  playlistId: null,
  params: null,
});

const history = (videoId: string, channelId: string): WatchHistoryRecord => ({
  videoId,
  title: videoId,
  channelId,
  channelName: channelId,
  watchDate: '2026-01-01',
  watchDurationSeconds: 120,
  isMusic: true,
});

describe('selectQuickPickSeeds', () => {
  it('keeps the current track first and prefers distinct recent artists', () => {
    const seeds = selectQuickPickSeeds(
      [
        history('recent-same-artist', 'artist-a'),
        history('artist-b-song', 'artist-b'),
        history('artist-c-song', 'artist-c'),
      ],
      song('current', 'artist-a'),
      3,
    );

    expect(seeds.map((seed) => seed.videoId)).toEqual(['current', 'artist-b-song', 'artist-c-song']);
  });

  it('fills remaining lanes from repeated artists when taste history is narrow', () => {
    const seeds = selectQuickPickSeeds(
      [history('one', 'artist-a'), history('two', 'artist-a'), history('three', 'artist-a')],
      null,
      3,
    );

    expect(seeds.map((seed) => seed.videoId)).toEqual(['one', 'two', 'three']);
  });

  it('interleaves liked songs with history while keeping artists distinct', () => {
    const seeds = selectQuickPickSeeds(
      [history('history-a', 'artist-a'), history('history-b', 'artist-b')],
      null,
      3,
      [song('liked-c', 'artist-c')],
    );
    expect(seeds.map((seed) => seed.videoId)).toEqual(['history-a', 'liked-c', 'history-b']);
  });
});

describe('interleaveQuickPickLanes', () => {
  it('mixes lanes, excludes seeds, and deduplicates globally', () => {
    const mixed = interleaveQuickPickLanes(
      [
        [song('seed'), song('radio-1'), song('shared'), song('radio-2')],
        [song('related-1'), song('shared'), song('related-2')],
        [song('chart-1'), song('chart-2')],
      ],
      6,
      ['seed'],
    );

    expect(mixed.map((item) => item.id)).toEqual([
      'radio-1',
      'related-1',
      'chart-1',
      'shared',
      'related-2',
      'chart-2',
    ]);
  });

  it('caps charts and artists and excludes alternate recordings and videos', () => {
    const alternate = { ...song('alternate', 'artist-a'), title: 'same title' };
    const first = { ...song('first', 'artist-a'), title: 'same title' };
    const video = { ...song('video', 'artist-v'), musicVideoType: 'MUSIC_VIDEO_TYPE_OMV' };
    const mixed = interleaveQuickPickLanes(
      [
        [first, alternate, song('a-2', 'artist-a'), song('a-3', 'artist-a'), song('a-4', 'artist-a'), video],
        [song('b-1', 'artist-b'), song('b-2', 'artist-b')],
        [song('chart-1', 'artist-c'), song('chart-2', 'artist-d'), song('chart-3', 'artist-e')],
      ],
      12,
      [],
      { chartLaneIndex: 2, chartLimit: 2, artistLimit: 3 },
    );
    expect(mixed.map((item) => item.id)).toEqual([
      'first', 'b-1', 'chart-1', 'a-2', 'b-2', 'chart-2', 'a-3',
    ]);
  });
});

describe('pickFanArtists', () => {
  it('takes one neighbour from each top artist in turn and skips known artists', () => {
    const picked = pickFanArtists([['a1', 'a2', 'a3'], ['top', 'b1'], ['c1']], new Set(['top']), 4);
    expect(picked).toEqual(['a1', 'c1', 'a2', 'b1']);
  });
});
