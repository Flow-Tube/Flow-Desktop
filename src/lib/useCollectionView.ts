import { useEffect, useMemo, useState } from 'react';

import {
  availableMusicSortOrders,
  filterSongsBySearch,
  loadMusicSortOrder,
  resolveMusicSortOrder,
  saveMusicSortOrder,
  sortSongsForCollection,
  type MusicSortOrder,
} from './musicCollectionSort';
import { useDebounce } from './useDebounce';
import type { SongItem } from '../types/music';

const SEARCH_PAUSE_MS = 150;

interface CollectionViewInput {
  id: string | undefined;
  songs: SongItem[];
  isAlbumKind: boolean;
  isOwned: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
}

/** What a music page shows: its songs in the order remembered for it, narrowed by its search. */
export function useCollectionView({ id, songs, isAlbumKind, isOwned, hasMore, loadingMore, loadMore }: CollectionViewInput) {
  const [query, setQuery] = useState('');
  const [storedOrder, setStoredOrder] = useState<string | null>(() => (id ? loadMusicSortOrder(id) : null));

  useEffect(() => {
    setStoredOrder(id ? loadMusicSortOrder(id) : null);
    setQuery('');
  }, [id]);

  const hasAlbums = useMemo(() => songs.some((song) => Boolean(song.album?.name)), [songs]);
  const sortOrders = useMemo(
    () => availableMusicSortOrders({ isOnlineAlbum: isAlbumKind && !isOwned, isOwned, isAlbumKind, hasAlbums }),
    [hasAlbums, isAlbumKind, isOwned],
  );
  const sortOrder = resolveMusicSortOrder(storedOrder, sortOrders);
  const setSortOrder = (next: MusicSortOrder) => {
    setStoredOrder(next);
    if (id) saveMusicSortOrder(id, next);
  };

  const debouncedQuery = useDebounce(query, SEARCH_PAUSE_MS);
  const ordered = useMemo(() => sortSongsForCollection(songs, sortOrder), [songs, sortOrder]);
  const shown = useMemo(() => filterSongsBySearch(ordered, debouncedQuery), [ordered, debouncedQuery]);

  // A sort or search is only right over the whole list, not the pages loaded so far.
  const needsWholeList = sortOrder !== 'collection' || debouncedQuery.trim() !== '';
  useEffect(() => {
    if (needsWholeList && hasMore && !loadingMore) void loadMore();
  }, [needsWholeList, hasMore, loadingMore, loadMore]);

  const positions = useMemo(() => new Map(songs.map((song, index) => [song.videoId ?? song.id, index + 1])), [songs]);

  return { query, setQuery, debouncedQuery, sortOrder, sortOrders, setSortOrder, ordered, shown, positions };
}
