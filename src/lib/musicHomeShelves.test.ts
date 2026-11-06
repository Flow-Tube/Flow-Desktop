import { describe, expect, it } from 'vitest';

import { MUSIC_HOME_SHELVES, isShelfShown, parseHiddenShelves, shelfOfEntry, withShelfShown } from './musicHomeShelves';
import { composeMusicFeed, type MusicFeedEntry } from './musicFeedComposer';
import type { MusicShelf, SongItem, YTItem } from '../types/music';

const song = (id: string, type = 'MUSIC_VIDEO_TYPE_ATV'): YTItem => ({
  type: 'song',
  id,
  title: id,
  artists: [{ name: id, id }],
  album: null,
  duration: 100,
  musicVideoType: type,
  thumbnail: '',
  explicit: false,
  videoId: id,
  playlistId: null,
  params: null,
});

const entry = (id: string, source?: string): MusicFeedEntry => ({
  kind: 'section',
  section: { id, title: id, items: [], origin: 'personal', source },
});

describe('shelfOfEntry', () => {
  it('names the switch for each kind of home section', () => {
    expect(shelfOfEntry({ kind: 'quickPicks' })).toBe('QUICK_PICKS');
    expect(shelfOfEntry({ kind: 'moods' })).toBe('MOODS_AND_GENRES');
    expect(shelfOfEntry(entry('your-playlists'))).toBe('YOUR_PLAYLISTS');
    expect(shelfOfEntry(entry('similar-abc'))).toBe('SIMILAR_TO');
    expect(shelfOfEntry(entry('mix-2'))).toBe('SIMILAR_TO');
    expect(shelfOfEntry(entry('genre-x:y'))).toBe('GENRES');
    expect(shelfOfEntry(entry('x', 'chart-1'))).toBe('CHARTS');
    expect(shelfOfEntry(entry('x', 'newReleases'))).toBe('NEW_RELEASES');
    expect(shelfOfEntry(entry('remote:anything'))).toBe('DYNAMIC_HOME');
  });

  it('has a row for every switch it can name', () => {
    const ids = new Set<string>(MUSIC_HOME_SHELVES.map((shelf) => shelf.id));
    for (const id of ['on-repeat', 'rotation', 'lastfm-discover', 'live-performances', 'music-videos', 'popular-songs']) {
      expect(ids.has(shelfOfEntry(entry(id)))).toBe(true);
    }
  });
});

describe('hidden shelves', () => {
  it('reads what is stored and ignores what it cannot read', () => {
    expect([...parseHiddenShelves('["CHARTS", 1]')]).toEqual(['CHARTS']);
    expect(parseHiddenShelves('oops').size).toBe(0);
    expect(parseHiddenShelves(undefined).size).toBe(0);
  });

  it('turns a switch on and off', () => {
    const hidden = new Set(withShelfShown(new Set(), 'CHARTS', false));
    expect(isShelfShown(entry('x', 'chart-1'), hidden)).toBe(false);
    expect(isShelfShown(entry('on-repeat'), hidden)).toBe(true);
    expect(withShelfShown(hidden, 'CHARTS', true)).toEqual([]);
  });
});

describe('titled YouTube shelves', () => {
  const remote = (title: string, id: string): MusicShelf => ({
    title,
    subtitle: null,
    browseId: null,
    params: null,
    source: 'home',
    items: [song(id, 'MUSIC_VIDEO_TYPE_OMV'), song(`${id}2`, 'MUSIC_VIDEO_TYPE_OMV'), song(`${id}3`, 'MUSIC_VIDEO_TYPE_OMV')],
  } as MusicShelf);
  const ids = (feed: MusicFeedEntry[]) => feed.flatMap((e) => (e.kind === 'section' ? [e.section.id] : []));

  it('get their own switch, and Music videos gives way to the personal shelf', () => {
    const both = composeMusicFeed([], [remote('Music videos', 'a'), remote('Music videos for you', 'b'), remote('Live performances', 'c')], 'mature', [] as SongItem[]);
    expect(ids(both)).toContain('music-videos-for-you');
    expect(ids(both)).toContain('live-performances');
    expect(ids(both)).not.toContain('music-videos');
    expect(ids(composeMusicFeed([], [remote('Music videos', 'a')], 'mature', []))).toContain('music-videos');
  });

  it('leave other titles as generic YouTube shelves', () => {
    expect(ids(composeMusicFeed([], [remote('Anything else', 'a')], 'mature', []))[0]).toMatch(/^remote:/);
  });
});

describe('order', () => {
  const personal = (id: string) => ({ id, title: id, items: [song(`${id}1`), song(`${id}2`), song(`${id}3`)] });

  it('puts your library first and Last.fm after the shuffled shelves', () => {
    const feed = composeMusicFeed(
      [personal('lastfm-discover'), personal('other-a'), personal('your-subscriptions'), personal('your-playlists'), personal('other-b')],
      [],
      'mature',
      [],
    ).flatMap((e) => (e.kind === 'section' ? [e.section.id] : []));
    expect(feed.slice(0, 2)).toEqual(['your-playlists', 'your-subscriptions']);
    expect(feed[feed.length - 1]).toBe('lastfm-discover');
  });
});
