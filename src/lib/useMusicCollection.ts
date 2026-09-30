import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getMusicAlbumContinuation,
  getMusicAlbumPage,
  getMusicPlaylistContinuation,
  getMusicPlaylistPage,
} from './api/music';
import { getBackendErrorMessage } from './api/errors';
import { getString } from './i18n/index';
import { artistsText } from './musicFormat';
import { useAlbumLibraryStore, type StoredAlbum } from '../store/useAlbumLibraryStore';
import type { AlbumItem, AlbumPage, MusicPlaylistPage, SongItem } from '../types/music';

export type CollectionKind = 'album' | 'playlist';

/** Display-normalized header shared by the album & playlist detail pages. */
export interface CollectionMeta {
  kind: CollectionKind;
  title: string;
  thumbnail: string | null;
  typeLabel: string;
  explicit: boolean;
  artistName: string | null;
  artistId: string | null;
  yearText: string | null;
  trackCountText: string | null;
  durationText: string | null;
  stats: string | null;
  description: string | null;
}

interface InitialLoad {
  meta: CollectionMeta;
  songs: SongItem[];
  otherVersions: AlbumItem[];
  continuation: string | null;
}

function songKey(song: SongItem): string {
  return song.videoId ?? song.id;
}

function uniqueSongs(songs: SongItem[]): SongItem[] {
  const seen = new Set<string>();
  return songs.filter((song) => {
    const key = songKey(song);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function appendUniqueSongs(current: SongItem[], next: SongItem[]): SongItem[] {
  const seen = new Set(current.map(songKey));
  const uniqueNext = next.filter((song) => {
    const key = songKey(song);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return uniqueNext.length ? [...current, ...uniqueNext] : current;
}

function albumMeta(page: AlbumPage): CollectionMeta {
  const yearText = page.album.year ? String(page.album.year) : null;
  const trackCountText = page.songCount != null ? getString('music_songs_count', page.songCount) : null;
  const durationText = page.durationText?.trim() || null;
  const stats = [
    yearText,
    trackCountText,
    durationText,
  ]
    .filter((p): p is string => Boolean(p))
    .join('  •  ');
  return {
    kind: 'album',
    title: page.album.title,
    thumbnail: page.album.thumbnail || null,
    typeLabel: getString('music_album_label'),
    explicit: page.album.explicit,
    artistName: artistsText(page.album.artists) || null,
    artistId: page.album.artists?.[0]?.id ?? null,
    yearText,
    trackCountText,
    durationText,
    stats: stats || null,
    description: page.description?.trim() || null,
  };
}

function playlistMeta(page: MusicPlaylistPage): CollectionMeta {
  const trackCountText = page.songCountText?.trim() || null;
  return {
    kind: 'playlist',
    title: page.title,
    thumbnail: page.thumbnail || null,
    typeLabel: getString('music_playlist_label'),
    explicit: false,
    artistName: page.author?.name ?? null,
    artistId: page.author?.id ?? null,
    yearText: null,
    trackCountText,
    durationText: null,
    stats: trackCountText,
    description: page.description?.trim() || null,
  };
}

function ownedAlbumMeta(album: StoredAlbum): CollectionMeta {
  const tracks = album.tracks ?? [];
  const trackCountText = getString('music_songs_count', tracks.length);
  return {
    kind: 'album',
    title: album.title,
    thumbnail: album.thumbnail ?? tracks.find((t) => t.thumbnail)?.thumbnail ?? null,
    typeLabel: getString('music_album_label'),
    explicit: false,
    artistName: null,
    artistId: null,
    yearText: null,
    trackCountText,
    durationText: null,
    stats: trackCountText,
    description: album.description?.trim() || null,
  };
}

const noop = async () => {};

async function loadAlbum(id: string): Promise<InitialLoad> {
  const page = await getMusicAlbumPage(id);
  return { meta: albumMeta(page), songs: uniqueSongs(page.songs),
    otherVersions: page.otherVersions ?? [], continuation: page.continuation };
}

async function loadPlaylist(id: string): Promise<InitialLoad> {
  const page = await getMusicPlaylistPage(id);
  return { meta: playlistMeta(page), songs: uniqueSongs(page.songs),
    otherVersions: [], continuation: page.continuation };
}

/**
 * Shared loader for the music album & playlist detail pages: an initial fetch
 * (header + first song page) plus continuation paging over the track list. The
 * `fetchInitial`/`fetchMore` pair are module-level constants, so they're stable.
 */
export function useMusicCollection(kind: CollectionKind, id: string | undefined) {
  const fetchInitial = kind === 'album' ? loadAlbum : loadPlaylist;
  const fetchMore = kind === 'album' ? getMusicAlbumContinuation : getMusicPlaylistContinuation;

  const ownedAlbum = useAlbumLibraryStore((s) =>
    kind === 'album' && id ? s.albums.find((a) => a.id === id && a.source === 'Owned') : undefined,
  );
  const ownedRef = useRef(false);
  ownedRef.current = Boolean(ownedAlbum);

  const [meta, setMeta] = useState<CollectionMeta | null>(null);
  const [songs, setSongs] = useState<SongItem[]>([]);
  const [otherVersions, setOtherVersions] = useState<AlbumItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqRef = useRef(0);
  const contRef = useRef<string | null>(null);
  const seenContinuationsRef = useRef<Set<string>>(new Set());
  const loadingMoreRef = useRef(false);

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      setError(getBackendErrorMessage(new Error('missing id')));
      return;
    }
    if (ownedRef.current) {
      setLoading(false);
      setError(null);
      return;
    }
    const req = ++reqRef.current;
    setLoading(true);
    setError(null);
    contRef.current = null;
    setHasMore(false);
    seenContinuationsRef.current = new Set();
    setSongs([]);
    setOtherVersions([]);
    setMeta(null);
    try {
      const res = await fetchInitial(id);
      if (reqRef.current !== req) return;
      setMeta(res.meta);
      setSongs(res.songs);
      setOtherVersions(res.otherVersions);
      contRef.current = res.continuation;
      setHasMore(Boolean(res.continuation));
      if (res.continuation) seenContinuationsRef.current.add(res.continuation);
    } catch (e) {
      if (reqRef.current === req) setError(getBackendErrorMessage(e));
    } finally {
      if (reqRef.current === req) setLoading(false);
    }
  }, [id, fetchInitial]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !contRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const req = reqRef.current;
    const token = contRef.current;
    try {
      const [more, next] = await fetchMore(token);
      if (reqRef.current !== req) return;
      const unseenNext = next && !seenContinuationsRef.current.has(next) ? next : null;
      if (unseenNext) seenContinuationsRef.current.add(unseenNext);
      contRef.current = unseenNext;
      setHasMore(Boolean(unseenNext));
      setSongs((prev) => appendUniqueSongs(prev, more));
    } catch {
      contRef.current = null;
      setHasMore(false);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [fetchMore]);

  useEffect(() => {
    void load();
  }, [load]);

  if (ownedAlbum) {
    return {
      meta: ownedAlbumMeta(ownedAlbum),
      songs: ownedAlbum.tracks ?? [],
      otherVersions: [],
      loading: false,
      loadingMore: false,
      error: null,
      hasMore: false,
      loadMore: noop,
      reload: noop,
      ownedAlbumId: ownedAlbum.id as string | null,
    };
  }

  return {
    meta,
    songs,
    otherVersions,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    reload: load,
    ownedAlbumId: null as string | null,
  };
}
