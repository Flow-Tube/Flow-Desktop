import { describe, expect, it } from 'vitest';
import { composeMusicFeed, feedGroupOf, type MusicFeedEntry } from './musicFeedComposer';
import type { MusicShelf, SongItem, YTItem } from '../types/music';
import type { PersonalSection } from './useMusicPersonalization';

const song = (id: string, title = id): SongItem => ({
  id, videoId: id, title, artists: [{ name: 'Artist', id: 'artist' }], album: null,
  duration: 180, musicVideoType: 'MUSIC_VIDEO_TYPE_ATV', thumbnail: '',
  explicit: false, playlistId: null, params: null,
});
const item = (id: string, title = id): YTItem => ({ type: 'song', ...song(id, title) });
const items = (prefix: string, count = 4) => Array.from({ length: count }, (_, index) => item(`${prefix}-${index}`));
const personal = (id: string, count = 4): PersonalSection => ({ id, title: id, items: items(id, count) });
const remote = (title: string, source?: string): MusicShelf => ({
  title, subtitle: null, browseId: null, params: null, source, items: items(title),
});
const names = (feed: MusicFeedEntry[]) =>
  feed.map((entry) => (entry.kind === 'section' ? entry.section.id.replace(/:.*$/, '') + ':' + entry.section.title : entry.kind));

describe('music feed order', () => {
  it('puts the personal block first in its fixed order, whatever the input order', () => {
    const feed = composeMusicFeed(
      [personal('deep-cuts'), personal('daily-discover'), personal('listen-again'), personal('speed-dial')],
      [], 'mature', [], { sessionSeed: 1 },
    );
    expect(names(feed).slice(0, 3)).toEqual([
      'listen-again:listen-again', 'speed-dial:speed-dial', 'deep-cuts:deep-cuts',
    ]);
  });

  it('leads a first-run home with charts, moods and new releases', () => {
    const feed = composeMusicFeed(
      [personal('daily-discover')],
      [remote('Home shelf'), remote('Top songs', 'chartSongs'), remote('Releases', 'newReleases')],
      'cold_start', [song('pick')], { hasMoods: true, sessionSeed: 7 },
    );
    const order = names(feed);
    expect(order.slice(0, 3)).toEqual(['remote:Top songs', 'moods', 'remote:Releases']);
    expect(order[order.length - 1]).toBe('remote:Home shelf');
    expect(order).toContain('quickPicks');
  });

  it('leads an established home with Quick Picks, the Similar to groups and community', () => {
    const feed = composeMusicFeed(
      [personal('from-community'), personal('popular-songs'), personal('similar-queen'),
        personal('performances-queen'), personal('daily-discover')],
      [], 'mature', [song('pick')], { sessionSeed: 3 },
    );
    expect(names(feed).slice(0, 4)).toEqual([
      'quickPicks', 'similar-queen:similar-queen', 'performances-queen:performances-queen',
      'from-community:from-community',
    ]);
  });

  it('keeps the shuffled middle stable for a session as sections stream in', () => {
    const early = composeMusicFeed([personal('daily-discover'), personal('popular-songs')], [], 'warming', [],
      { sessionSeed: 42 });
    const later = composeMusicFeed(
      [personal('daily-discover'), personal('fans-a'), personal('popular-songs'), personal('mix-1')],
      [], 'warming', [], { sessionSeed: 42 },
    );
    const relative = names(later).filter((name) => name.startsWith('daily') || name.startsWith('popular'));
    expect(relative).toEqual(names(early));
  });

  it('groups a Similar to row with its performances and More from rows', () => {
    const group = (id: string) => feedGroupOf({ kind: 'section', section: { ...personal(id), origin: 'personal' } });
    expect(group('similar-UCq')).toBe(group('performances-UCq'));
    expect(group('artist-albums-UCq')).toBe('similar:UCq');
  });
});

describe('music feed deduplication', () => {
  it('lets Quick Picks claim their songs and drops shelves shrunk below four items', () => {
    const feed = composeMusicFeed(
      [{ id: 'listen-again', title: 'Listen again', items: [item('a'), item('b'), item('c'), item('d')] },
        { id: 'daily-discover', title: 'Daily', items: [item('a'), item('b'), item('c'), item('e'), item('f')] }],
      [], 'mature', [song('seed', 'Same')], { sessionSeed: 1 },
    );
    expect(names(feed)).toEqual(['listen-again:Listen again', 'quickPicks']);
  });

  it('keeps naturally small shelves', () => {
    const feed = composeMusicFeed([personal('rotation', 3)], [], 'mature', [], { sessionSeed: 1 });
    expect(feed[0]?.kind === 'section' && feed[0].section.items).toHaveLength(3);
  });
});
