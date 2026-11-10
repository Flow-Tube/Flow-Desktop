import { beforeEach, describe, expect, it, vi } from 'vitest';

const startMusicDownload = vi.fn();
vi.mock('./api/db', () => ({ getSetting: vi.fn(), setSetting: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./downloadActions', () => ({ startMusicDownload: (...args: unknown[]) => startMusicDownload(...args) }));

import { downloadSongs, playSongsNext, removeSongsWithUndo } from './useCollectionSelectionActions';
import { useAlbumLibraryStore, type StoredAlbum } from '../store/useAlbumLibraryStore';
import { useDownloadsLibraryStore } from '../store/useDownloadsLibraryStore';
import { useMusicPlayerStore } from '../store/useMusicPlayerStore';
import { useUiStore } from '../store/useUiStore';
import type { SongItem } from '../types/music';

const song = (id: string) => ({ id, videoId: id, title: id, thumbnail: '', artists: [] } as unknown as SongItem);

describe('selection actions', () => {
  beforeEach(() => {
    useDownloadsLibraryStore.setState({ load: vi.fn().mockResolvedValue(undefined) } as never);
  });

  it('starts picked songs in order when nothing is playing', () => {
    const playQueue = vi.fn().mockResolvedValue(undefined);
    const playNextInQueue = vi.fn();
    const original = useMusicPlayerStore.getState();
    useMusicPlayerStore.setState({ currentTrack: null, playQueue, playNextInQueue });
    const songs = [song('a'), song('b')];
    playSongsNext(songs);
    useMusicPlayerStore.setState({ playQueue: original.playQueue, playNextInQueue: original.playNextInQueue });
    expect(playQueue).toHaveBeenCalledWith(songs, 0);
    expect(playNextInQueue).not.toHaveBeenCalled();
  });

  it('queues picked songs so the first plays first', () => {
    const order: string[] = [];
    const original = useMusicPlayerStore.getState().playNextInQueue;
    useMusicPlayerStore.setState({ currentTrack: song('now'), playNextInQueue: (track: SongItem) => void order.unshift(track.id) });
    playSongsNext([song('a'), song('b'), song('c')]);
    useMusicPlayerStore.setState({ currentTrack: null, playNextInQueue: original });
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('removes songs and offers an Undo that puts them back in place', async () => {
    const tracks = [song('a'), song('b'), song('c')];
    const album: StoredAlbum = { id: 'own', title: 'Mine', source: 'Owned', tracks };
    useAlbumLibraryStore.setState({ albums: [album] });
    const showToast = vi.fn();
    useUiStore.setState({ showToast } as never);

    await removeSongsWithUndo(album, [tracks[1]!]);
    expect(useAlbumLibraryStore.getState().albums[0]?.tracks?.map((t) => t.id)).toEqual(['a', 'c']);

    const undo = showToast.mock.calls[0]?.[0].actions.find((a: { onSelect?: () => void }) => a.onSelect);
    undo.onSelect();
    await vi.waitFor(() =>
      expect(useAlbumLibraryStore.getState().albums[0]?.tracks?.map((t) => t.id)).toEqual(['a', 'b', 'c']),
    );
  });

  it('reports how many downloads started and a failure when none did', async () => {
    const showToast = vi.fn();
    useUiStore.setState({ showToast } as never);
    startMusicDownload.mockResolvedValueOnce({ id: '1' }).mockRejectedValueOnce(new Error('no'));
    await downloadSongs([song('a'), song('b')]);
    expect(showToast.mock.calls[0]?.[0]).toMatchObject({ variant: 'success', message: '1 song added to downloads' });

    startMusicDownload.mockRejectedValue(new Error('no'));
    await downloadSongs([song('a')]);
    expect(showToast.mock.calls[1]?.[0].variant).toBe('error');
  });
});
