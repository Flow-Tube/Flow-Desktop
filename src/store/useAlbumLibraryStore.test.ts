import { beforeEach, describe, expect, it, vi } from 'vitest';

const setSetting = vi.fn();
vi.mock('../lib/api/db', () => ({ getSetting: vi.fn(), setSetting: (...args: unknown[]) => setSetting(...args) }));

import { useAlbumLibraryStore, type StoredAlbum } from './useAlbumLibraryStore';
import type { SongItem } from '../types/music';

const song = (id: string) => ({ id, videoId: id, thumbnail: `t-${id}`, title: id } as SongItem);
const owned = (tracks: SongItem[]): StoredAlbum => ({ id: 'own', title: 'Mine', source: 'Owned', description: 'old', tracks, thumbnail: null });

const album = () => useAlbumLibraryStore.getState().albums[0]!;

describe('own list edits', () => {
  beforeEach(() => {
    setSetting.mockReset();
    setSetting.mockResolvedValue(undefined);
    useAlbumLibraryStore.setState({ albums: [owned([song('a'), song('b')])] });
  });

  it('adds only new songs and says which went in', async () => {
    const added = await useAlbumLibraryStore.getState().addTracks('own', [song('b'), song('c'), song('c')]);
    expect(added.map((s) => s.id)).toEqual(['c']);
    expect(album().tracks?.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(album().thumbnail).toBe('t-c');
  });

  it('does not write when nothing is new', async () => {
    expect(await useAlbumLibraryStore.getState().addTracks('own', [song('a')])).toEqual([]);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('removes several and restores them in the same place', async () => {
    const before = album().tracks ?? [];
    await useAlbumLibraryStore.getState().removeTracks('own', ['a']);
    expect(album().tracks?.map((s) => s.id)).toEqual(['b']);
    await useAlbumLibraryStore.getState().restoreTracks('own', before);
    expect(album().tracks?.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('rolls a change back when it cannot be saved', async () => {
    setSetting.mockRejectedValue(new Error('disk'));
    await expect(useAlbumLibraryStore.getState().removeTracks('own', ['a'])).rejects.toThrow('disk');
    expect(album().tracks?.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('renames, keeping the old name for a blank one', async () => {
    await useAlbumLibraryStore.getState().updateDetails('own', '  New  ', ' About ');
    expect(album().title).toBe('New');
    expect(album().description).toBe('About');
    await useAlbumLibraryStore.getState().updateDetails('own', '   ', '');
    expect(album().title).toBe('New');
    expect(album().description).toBe('');
  });

  it('leaves saved albums alone', async () => {
    useAlbumLibraryStore.setState({ albums: [{ id: 'saved', title: 'S', source: 'Saved' }] });
    await useAlbumLibraryStore.getState().updateDetails('saved', 'Changed', '');
    expect(album().title).toBe('S');
  });
});
