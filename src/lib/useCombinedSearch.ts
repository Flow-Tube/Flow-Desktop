import { useCallback, useEffect, useRef, useState } from 'react';
import { searchVideos } from './api/youtube';
import {
  getMusicSearchSummary,
  searchMusicContinuation,
  searchMusicTyped,
} from './api/music';
import { getBackendErrorMessage } from './api/errors';
import { useDebounce } from './useDebounce';
import type { PlaylistSummary, VideoSummary } from '../types/video';
import type {
  AlbumItem,
  ArtistItem,
  EpisodeItem,
  MusicSearchSection,
  PlaylistItem,
  PodcastItem,
  SongItem,
} from '../types/music';

// --- Public types ---------------------------------------------------------

/** Category chips shown in the control bar. */
export type SearchCategory =
  | 'all'
  | 'videos'
  | 'songs'
  | 'albums'
  | 'playlists'
  | 'artists' // "Artists / Channels"
  | 'live'
  | 'podcasts'
  | 'episodes';

export type SearchSortBy = 'relevance' | 'date' | 'views' | 'rating';

export type SearchFeatureFilter = 'any' | 'hd' | '4k' | 'subtitles' | 'creative_commons' | 'hdr';

export interface AdvancedFilters {
  uploadDate: 'any' | 'hour' | 'today' | 'week' | 'month' | 'year';
  duration: 'any' | 'short' | 'medium' | 'long'; // short = <4min, medium = 4-20min, long = >20min
  feature: SearchFeatureFilter;
}

export type TopResult =
  | { kind: 'artist'; item: ArtistItem }
  | { kind: 'channel'; item: VideoSummary }
  | { kind: 'song'; item: SongItem }
  | { kind: 'video'; item: VideoSummary }
  | { kind: 'album'; item: AlbumItem };

export interface CombinedSearchResults {
  topResult: TopResult | null;
  songs: SongItem[];
  videos: VideoSummary[];
  live: VideoSummary[];
  channels: VideoSummary[];
  albums: AlbumItem[];
  playlists: PlaylistItem[];
  artists: ArtistItem[];
  podcasts: PodcastItem[];
  episodes: EpisodeItem[];
}

export interface UseCombinedSearchOptions {
  query: string;
  initialFilter?: SearchCategory;
  debounceMs?: number;
}

export interface UseCombinedSearchReturn {
  query: string;
  filterType: SearchCategory;
  setFilterType: (c: SearchCategory) => void;
  sortBy: SearchSortBy;
  setSortBy: (s: SearchSortBy) => void;
  filters: AdvancedFilters;
  setFilters: (f: AdvancedFilters) => void;
  results: CombinedSearchResults;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  error: string | null;
  fetchNextPage: () => void;
  refetch: () => void;
}

// --- Pure helpers ---------------------------------------------------------

function emptyResults(): CombinedSearchResults {
  return {
    topResult: null,
    songs: [],
    videos: [],
    live: [],
    channels: [],
    albums: [],
    playlists: [],
    artists: [],
    podcasts: [],
    episodes: [],
  };
}

type MusicBucket = {
  songs: SongItem[];
  albums: AlbumItem[];
  playlists: PlaylistItem[];
  artists: ArtistItem[];
  podcasts: PodcastItem[];
  episodes: EpisodeItem[];
};

function emptyBucket(): MusicBucket {
  return { songs: [], albums: [], playlists: [], artists: [], podcasts: [], episodes: [] };
}

function bucketMusicSections(sections: MusicSearchSection[]): MusicBucket {
  const out = emptyBucket();
  for (const section of sections) {
    for (const item of section.items) {
      switch (item.type) {
        case 'song':
          out.songs.push(item);
          break;
        case 'album':
          out.albums.push(item);
          break;
        case 'playlist':
          out.playlists.push(item);
          break;
        case 'artist':
          out.artists.push(item);
          break;
        case 'podcast':
          out.podcasts.push(item);
          break;
        case 'episode':
          out.episodes.push(item);
          break;
      }
    }
  }
  return out;
}

function splitYoutubeResults(items: VideoSummary[]): {
  videos: VideoSummary[];
  channels: VideoSummary[];
} {
  const videos: VideoSummary[] = [];
  const channels: VideoSummary[] = [];
  for (const item of items) {
    if (item.id?.startsWith('channel:')) channels.push(item);
    else videos.push(item);
  }
  return { videos, channels };
}

function dedupe<T>(arr: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    const k = key(x);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    out.push(x);
  }
  return out;
}

function mergeMusicBucket(
  base: CombinedSearchResults,
  category: SearchCategory,
  b: MusicBucket,
): CombinedSearchResults {
  switch (category) {
    case 'songs':
      return { ...base, songs: dedupe([...base.songs, ...b.songs], (s) => s.id) };
    case 'albums':
      return { ...base, albums: dedupe([...base.albums, ...b.albums], (a) => a.browseId) };
    case 'playlists':
      return { ...base, playlists: dedupe([...base.playlists, ...b.playlists], (p) => p.id) };
    case 'artists':
      return { ...base, artists: dedupe([...base.artists, ...b.artists], (a) => a.id) };
    case 'podcasts':
      return { ...base, podcasts: dedupe([...base.podcasts, ...b.podcasts], (p) => p.id) };
    case 'episodes':
      return { ...base, episodes: dedupe([...base.episodes, ...b.episodes], (e) => e.id) };
    default:
      return base;
  }
}

/** Map a category chip to a valid `search_music_typed` filter string. */
function categoryToMusicFilter(category: SearchCategory): string {
  switch (category) {
    case 'songs':
      return 'songs';
    case 'albums':
      return 'albums';
    case 'playlists':
      return 'community_playlists';
    case 'artists':
      return 'artists';
    case 'podcasts':
      return 'podcasts';
    case 'episodes':
      return 'episodes';
    default:
      return '';
  }
}

function pickTopResult(
  summaries: MusicSearchSection[],
  channels: VideoSummary[],
  artists: ArtistItem[],
): TopResult | null {
  const topSection = summaries.find((s) => /top result/i.test(s.title));
  const top = topSection?.items[0];
  if (top) {
    switch (top.type) {
      case 'artist':
        return { kind: 'artist', item: top };
      case 'song':
        return { kind: 'song', item: top };
      case 'album':
        return { kind: 'album', item: top };
    }
  }
  if (channels[0]) return { kind: 'channel', item: channels[0] };
  if (artists[0]) return { kind: 'artist', item: artists[0] };
  return null;
}

/** Drop the hero item from its bucket so it isn't rendered twice. */
function dedupeTopFromBuckets(r: CombinedSearchResults): CombinedSearchResults {
  const t = r.topResult;
  if (!t) return r;
  switch (t.kind) {
    case 'artist':
      return { ...r, artists: r.artists.filter((a) => a.id !== t.item.id) };
    case 'song':
      return { ...r, songs: r.songs.filter((s) => s.id !== t.item.id) };
    case 'album':
      return { ...r, albums: r.albums.filter((a) => a.browseId !== t.item.browseId) };
    case 'channel':
      return { ...r, channels: r.channels.filter((c) => c.id !== t.item.id) };
    case 'video':
      return { ...r, videos: r.videos.filter((v) => v.id !== t.item.id) };
  }
}

type FetchMode = 'reset' | 'next';

// --- Hook -----------------------------------------------------------------

export function useCombinedSearch(
  options: UseCombinedSearchOptions,
): UseCombinedSearchReturn {
  const { query, initialFilter = 'all', debounceMs = 350 } = options;

  const [filterType, setFilterType] = useState<SearchCategory>(initialFilter);
  const [sortBy, setSortBy] = useState<SearchSortBy>('relevance');
  const [filters, setFilters] = useState<AdvancedFilters>({
    uploadDate: 'any',
    duration: 'any',
    feature: 'any',
  });

  const [results, setResults] = useState<CombinedSearchResults>(emptyResults);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debouncedQuery = useDebounce(query.trim(), debounceMs);

  const seqRef = useRef(0);
  const ytTokenRef = useRef<string | null>(null);
  const musicContRef = useRef<string | null>(null);
  const queryRef = useRef(debouncedQuery);
  const filterRef = useRef(filterType);
  const sortRef = useRef(sortBy);
  const filtersRef = useRef(filters);
  const hasNextRef = useRef(false);
  const fetchingRef = useRef(false);
  queryRef.current = debouncedQuery;
  filterRef.current = filterType;
  sortRef.current = sortBy;
  filtersRef.current = filters;

  const setNext = useCallback((v: boolean) => {
    hasNextRef.current = v;
    setHasNextPage(v);
  }, []);

  const execute = useCallback(
    async (mode: FetchMode) => {
      const q = queryRef.current;
      const category = filterRef.current;

      if (!q) {
        setResults(emptyResults());
        setNext(false);
        setError(null);
        return;
      }
      if (mode === 'next' && (fetchingRef.current || !hasNextRef.current)) return;

      const seq = ++seqRef.current;
      const alive = () => seq === seqRef.current;

      if (mode === 'reset') {
        setIsLoading(true);
        setError(null);
        setResults(emptyResults());
        ytTokenRef.current = null;
        musicContRef.current = null;
        fetchingRef.current = false;
      } else {
        fetchingRef.current = true;
        setIsFetchingNextPage(true);
      }

      try {
        if (category === 'all') {
          const [ytRes, liveRes, musicRes] = await Promise.allSettled([
            searchVideos({ query: q }),
            searchVideos({ query: q, feature: 'live' }),
            getMusicSearchSummary(q),
          ]);
          if (!alive()) return;

          const split =
            ytRes.status === 'fulfilled'
              ? splitYoutubeResults(ytRes.value.items)
              : { videos: [], channels: [] };
          const live =
            liveRes.status === 'fulfilled'
              ? splitYoutubeResults(liveRes.value.items).videos
              : [];
          const summaries =
            musicRes.status === 'fulfilled' ? musicRes.value.summaries : [];
          const bucket = bucketMusicSections(summaries);

          // The "All" view is a bounded set of shelves — no infinite scroll.
          setNext(false);
          setResults(
            dedupeTopFromBuckets({
              topResult: pickTopResult(summaries, split.channels, bucket.artists),
              videos: split.videos,
              live,
              channels: split.channels,
              songs: bucket.songs,
              albums: bucket.albums,
              playlists: bucket.playlists,
              artists: bucket.artists,
              podcasts: bucket.podcasts,
              episodes: bucket.episodes,
            }),
          );

          if (ytRes.status === 'rejected' && musicRes.status === 'rejected') {
            setError(getBackendErrorMessage(ytRes.reason));
          }
          return;
        }

        if (category === 'videos' || category === 'live') {
          const isLive = category === 'live';
          const pageToken = mode === 'next' ? ytTokenRef.current : null;
          const adv = filtersRef.current;
          const res = await searchVideos({
            query: q,
            pageToken,
            sortBy: sortRef.current,
            uploadDate: adv.uploadDate,
            duration: adv.duration,
            // Innertube takes a single feature param, so the Live category wins.
            feature: isLive ? 'live' : adv.feature !== 'any' ? adv.feature : undefined,
          });
          if (!alive()) return;

          const { videos, channels } = splitYoutubeResults(res.items);
          ytTokenRef.current = res.nextPageToken ?? null;
          setNext(Boolean(res.nextPageToken));
          setResults((prev) => {
            if (isLive) {
              return mode === 'next'
                ? { ...prev, live: dedupe([...prev.live, ...videos], (v) => v.id) }
                : { ...emptyResults(), live: videos };
            }
            return mode === 'next'
              ? { ...prev, videos: dedupe([...prev.videos, ...videos], (v) => v.id) }
              : { ...emptyResults(), videos, channels };
          });
          return;
        }

        // --- Music-backed categories (songs / albums / playlists / artists).
        if (mode === 'next') {
          const cont = musicContRef.current;
          if (!cont) {
            setNext(false);
            return;
          }
          const res = await searchMusicContinuation(cont);
          if (!alive()) return;
          musicContRef.current = res.continuation;
          setNext(Boolean(res.continuation));
          const b = bucketMusicSections(res.sections);
          setResults((prev) => mergeMusicBucket(prev, category, b));
          return;
        }

        if (category === 'artists') {
          // "Artists / Channels" is federated: music artists + YouTube channels.
          const [musicR, ytR] = await Promise.allSettled([
            searchMusicTyped(q, 'artists'),
            searchVideos({ query: q }),
          ]);
          if (!alive()) return;

          const b =
            musicR.status === 'fulfilled'
              ? bucketMusicSections(musicR.value.sections)
              : emptyBucket();
          const channels =
            ytR.status === 'fulfilled'
              ? splitYoutubeResults(ytR.value.items).channels
              : [];
          musicContRef.current =
            musicR.status === 'fulfilled' ? musicR.value.continuation : null;
          setNext(Boolean(musicContRef.current));
          setResults(mergeMusicBucket({ ...emptyResults(), channels }, 'artists', b));

          if (musicR.status === 'rejected' && ytR.status === 'rejected') {
            setError(getBackendErrorMessage(musicR.reason));
          }
          return;
        }

        const res = await searchMusicTyped(q, categoryToMusicFilter(category));
        if (!alive()) return;
        musicContRef.current = res.continuation;
        setNext(Boolean(res.continuation));
        const b = bucketMusicSections(res.sections);
        setResults(mergeMusicBucket(emptyResults(), category, b));
      } catch (err) {
        if (alive()) setError(getBackendErrorMessage(err));
      } finally {
        if (alive()) {
          setIsLoading(false);
          fetchingRef.current = false;
          setIsFetchingNextPage(false);
        }
      }
    },
    [setNext],
  );

  useEffect(() => {
    void execute('reset');
  }, [
    debouncedQuery,
    filterType,
    sortBy,
    filters.uploadDate,
    filters.duration,
    execute,
  ]);

  const fetchNextPage = useCallback(() => {
    void execute('next');
  }, [execute]);

  const refetch = useCallback(() => {
    void execute('reset');
  }, [execute]);

  return {
    query: debouncedQuery,
    filterType,
    setFilterType,
    sortBy,
    setSortBy,
    filters,
    setFilters,
    results,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    error,
    fetchNextPage,
    refetch,
  };
}

export type { PlaylistSummary };

export default useCombinedSearch;
