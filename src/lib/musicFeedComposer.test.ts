import { describe, expect, it } from 'vitest';
import { composeMusicFeed } from './musicFeedComposer';
import type { SongItem, YTItem } from '../types/music';

const song = (id: string, title = id): SongItem => ({
  id, videoId: id, title, artists: [{ name: 'Artist', id: 'artist' }], album: null,
  duration: 180, musicVideoType: 'MUSIC_VIDEO_TYPE_ATV', thumbnail: '',
  explicit: false, playlistId: null, params: null,
});
const item = (id: string, title = id): YTItem => ({ type: 'song', ...song(id, title) });

describe('music feed composer', () => {
  it('leads a cold home with chart and releases while preserving unknown shelves', () => {
    const feed = composeMusicFeed(
      [{ id: 'personal', title: 'Personal', items: [item('personal')] }],
      [
        { title: 'Unknown', subtitle: null, browseId: null, params: null, items: [item('unknown')] },
        { title: 'Charts', subtitle: null, browseId: null, params: null,
          source: 'chartSongs', items: [item('chart')] },
        { title: 'Releases', subtitle: null, browseId: null, params: null,
          source: 'newReleases', items: [item('release')] },
      ],
      'cold_start', [],
    );
    expect(feed.map((section) => section.title)).toEqual(['Charts', 'Releases', 'Personal', 'Unknown']);
  });

  it('deduplicates alternate recordings and keeps section ids stable', () => {
    const remote = [{ title: 'More', subtitle: null, browseId: 'browse', params: null,
      items: [item('alternate', 'Same'), item('b'), item('c'), item('d'), item('e')] }];
    const feed = composeMusicFeed([], remote, 'mature', [song('seed', 'Same')]);
    expect(feed[0]?.items.map((entry) => 'id' in entry && entry.id)).toEqual(['b', 'c', 'd', 'e']);
    expect(feed[0]?.id).toBe(composeMusicFeed([], remote, 'mature', [song('seed', 'Same')])[0]?.id);
  });
});

describe('music feed composer shelf sizes', () => {
  const personal = (id: string, ids: string[]) => ({ id, title: id, items: ids.map((entry) => item(entry)) });

  it('drops a shelf that deduplication shrank below four items', () => {
    const feed = composeMusicFeed(
      [personal('first', ['a', 'b', 'c', 'd']), personal('second', ['a', 'b', 'c', 'e', 'f'])],
      [], 'mature', [],
    );
    expect(feed.map((section) => section.id)).toEqual(['first']);
  });

  it('keeps naturally small remote shelves', () => {
    const feed = composeMusicFeed([], [
      { title: 'Small', subtitle: null, browseId: null, params: null, items: [item('x'), item('y')] },
    ], 'mature', []);
    expect(feed[0]?.items).toHaveLength(2);
    expect(feed[0]?.origin).toBe('remote');
  });
});
