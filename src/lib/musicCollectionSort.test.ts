import { beforeEach, describe, expect, it } from 'vitest';

import {
  availableMusicSortOrders,
  filterSongsBySearch,
  loadMusicSortOrder,
  resolveMusicSortOrder,
  saveMusicSortOrder,
  sortSongsForCollection,
} from './musicCollectionSort';
import type { SongItem } from '../types/music';

const song = (id: string, title: string, artist: string, duration: number | null, album?: string): SongItem => ({
  id,
  title,
  artists: [{ name: artist, id: null }],
  album: album ? { name: album, id: 'a' } : null,
  duration,
  musicVideoType: null,
  thumbnail: '',
  explicit: false,
  videoId: id,
  playlistId: null,
  params: null,
});

const ids = (songs: SongItem[]) => songs.map((s) => s.id);
const songs = [song('1', 'beta', 'Zed', 200, 'Z'), song('2', 'Alpha', 'Amy', 100), song('3', 'gamma', 'Amy', 300, 'A')];

describe('availableMusicSortOrders', () => {
  it('keeps an online album to its order, title and length', () => {
    expect(availableMusicSortOrders({ isOnlineAlbum: true, isOwned: false, isAlbumKind: true, hasAlbums: true })).toEqual([
      'collection',
      'title',
      'longest',
      'shortest',
    ]);
  });

  it('offers date added only on your own lists, and album only when songs carry one', () => {
    const own = availableMusicSortOrders({ isOnlineAlbum: false, isOwned: true, isAlbumKind: true, hasAlbums: false });
    expect(own).toContain('newest_added');
    expect(own).not.toContain('album');
    const online = availableMusicSortOrders({ isOnlineAlbum: false, isOwned: false, isAlbumKind: false, hasAlbums: true });
    expect(online).not.toContain('newest_added');
    expect(online).toContain('album');
  });
});

describe('resolveMusicSortOrder', () => {
  it('falls back when the remembered order is not on offer', () => {
    expect(resolveMusicSortOrder('artist', ['collection', 'title'])).toBe('collection');
    expect(resolveMusicSortOrder('title', ['collection', 'title'])).toBe('title');
  });
});

describe('sortSongsForCollection', () => {
  it('sorts each way and keeps the original list untouched', () => {
    expect(ids(sortSongsForCollection(songs, 'title'))).toEqual(['2', '1', '3']);
    expect(ids(sortSongsForCollection(songs, 'newest_added'))).toEqual(['3', '2', '1']);
    expect(ids(sortSongsForCollection(songs, 'longest'))).toEqual(['3', '1', '2']);
    expect(ids(sortSongsForCollection(songs, 'shortest'))).toEqual(['2', '1', '3']);
    expect(ids(songs)).toEqual(['1', '2', '3']);
  });

  it('keeps ties in the page order and puts songs with no album last', () => {
    expect(ids(sortSongsForCollection(songs, 'artist'))).toEqual(['2', '3', '1']);
    expect(ids(sortSongsForCollection(songs, 'album'))).toEqual(['3', '1', '2']);
  });

  it('puts songs with no length last when shortest comes first', () => {
    const withUnknown = [song('x', 'x', 'x', null), song('y', 'y', 'y', 5)];
    expect(ids(sortSongsForCollection(withUnknown, 'shortest'))).toEqual(['y', 'x']);
  });
});

describe('filterSongsBySearch', () => {
  it('matches every word across title, artist and album', () => {
    expect(ids(filterSongsBySearch(songs, 'amy gamma'))).toEqual(['3']);
    expect(ids(filterSongsBySearch(songs, 'ZED'))).toEqual(['1']);
    expect(filterSongsBySearch(songs, '   ')).toBe(songs);
    expect(filterSongsBySearch(songs, 'nothing')).toEqual([]);
  });
});

describe('remembered order', () => {
  beforeEach(() => window.localStorage.clear());

  it('is kept per collection', () => {
    saveMusicSortOrder('a', 'title');
    saveMusicSortOrder('b', 'longest');
    expect(loadMusicSortOrder('a')).toBe('title');
    expect(loadMusicSortOrder('b')).toBe('longest');
    expect(loadMusicSortOrder('c')).toBeNull();
  });
});
