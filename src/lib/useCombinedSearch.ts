import { useCallback, useEffect, useRef, useState } from 'react';
import { searchVideos } from './api/youtube';
import {
  getMusicSearchSummary,
  searchMusicContinuation,
  searchMusicTyped,
} from './api/music';
import { getBackendErrorMessage } from './api/errors';
import { useDebounce } from './useDebounce';
import {
  bucketMusicSections,
  dedupe,
  dedupeTopFromBuckets,
  emptyBucket,
  emptyResults,
  pickTopResult,
  videoSections,
  type CombinedSearchResults,
  type MusicBucket,
} from './searchResults';
import type { PlaylistSummary, SearchFeature } from '../types/video';
import { learnFromSearch } from './api/recommendation';

export type { CombinedSearchResults, TopResult } from './searchResults';

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

/** YouTube reorders by relevance or view count only; recency is the upload-date filter. */
export type SearchSortBy = 'relevance' | 'views';

export type SearchFeatureFilter = Extract<SearchFeature, 'hd' | '4k' | 'subtitles' | 'creative_commons' | 'hdr'>;

export interface AdvancedFilters {
  uploadDate: 'any' | 'hour' | 'today' | 'week' | 'month' | 'year';
  /** short = under 3 min, medium = 3 to 20 min, long = over 20 min. */
  duration: 'any' | 'short' | 'medium' | 'long';
  contentType: 'any' | 'video' | 'shorts' | 'movie';
  /** Every selected feature must hold. */
  features: SearchFeatureFilter[];
}

export interface UseCombinedSearchOptions {
  query: string;
  initialFilter?: SearchCategory;
  debounceMs?: number;
}

export interface UseCombinedSearchReturn {
  query: string;
  /** The music filters YouTube Music offers for this query, once known. */
  offeredMusicFilters: string[] | null;
  filterType: SearchCategory;
  setFilterType: (c: SearchCategory) => void;
  sortBy: SearchSortBy;
  setSortBy: (s: SearchSortBy) => void;
  filters: AdvancedFilters;
  setFilters: (f: AdvancedFilters) => void;
  results: CombinedSearchResults;
  /** The search runs as typed, after "Search instead for" on a corrected query. */
  exact: boolean;
  searchExactly: () => void;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  error: string | null;
  fetchNextPage: () => void;
  refetch: () => void;
}

// --- Pure helpers ---------------------------------------------------------

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
    contentType: 'any',
    features: [],
  });

  const [results, setResults] = useState<CombinedSearchResults>(emptyResults);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The music filters YouTube Music offered, and the query it offered them for.
  const [offered, setOffered] = useState<{ query: string; filters: string[] } | null>(null);

  const debouncedQuery = useDebounce(query.trim(), debounceMs);
  // "Search instead for" applies to the query it was offered on; a new query is corrected again.
  const [exactQuery, setExactQuery] = useState<string | null>(null);
  const exact = exactQuery !== null && exactQuery === debouncedQuery;

  const seqRef = useRef(0);
  const ytTokenRef = useRef<string | null>(null);
  const musicContRef = useRef<string | null>(null);
  const queryRef = useRef(debouncedQuery);
  const filterRef = useRef(filterType);
  const sortRef = useRef(sortBy);
  const filtersRef = useRef(filters);
  const exactRef = useRef(exact);
  const hasNextRef = useRef(false);
  const learnedQueryRef = useRef<string | null>(null);
  const fetchingRef = useRef(false);
  queryRef.current = debouncedQuery;
  filterRef.current = filterType;
  sortRef.current = sortBy;
  filtersRef.current = filters;
  exactRef.current = exact;

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

      if (mode === 'reset' && q !== learnedQueryRef.current && (category === 'all' || category === 'videos' || category === 'live')) {
        learnedQueryRef.current = q;
        void learnFromSearch(q).catch((err) => console.warn('Failed to learn from a search', err));
      }

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
          const [ytRes, musicRes] = await Promise.allSettled([
            searchVideos({ query: q, exact: exactRef.current }),
            getMusicSearchSummary(q),
          ]);
          if (!alive()) return;

          const yt = ytRes.status === 'fulfilled' ? videoSections(ytRes.value) : null;
          const summaries = musicRes.status === 'fulfilled' ? musicRes.value.summaries : [];
          if (musicRes.status === 'fulfilled' && musicRes.value.filters?.length) {
            setOffered({ query: q, filters: musicRes.value.filters });
          }
          const bucket = bucketMusicSections(summaries);
          const channels = yt?.channels ?? [];

          // The "All" view is a bounded set of shelves — no infinite scroll.
          setNext(false);
          setResults(
            dedupeTopFromBuckets({
              ...emptyResults(),
              ...(yt ?? {}),
              topResult: pickTopResult(summaries, channels, bucket.artists),
              videos: (yt?.videos ?? []).filter((v) => !v.isLive),
              live: (yt?.videos ?? []).filter((v) => v.isLive),
              channels,
              ...bucket,
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
            contentType: adv.contentType === 'any' ? null : adv.contentType,
            features: isLive ? ['live', ...adv.features] : adv.features,
            exact: exactRef.current,
          });
          if (!alive()) return;

          const page = videoSections(res);
          ytTokenRef.current = res.nextPageToken ?? null;
          setNext(Boolean(res.nextPageToken));
          setResults((prev) => {
            if (mode === 'next') {
              const key = isLive ? 'live' : 'videos';
              return {
                ...prev,
                [key]: dedupe([...prev[key], ...page.videos], (v) => v.id),
                shorts: dedupe([...prev.shorts, ...page.shorts], (v) => v.id),
              };
            }
            return isLive
              ? { ...emptyResults(), live: page.videos, correction: page.correction }
              : { ...emptyResults(), ...page };
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

        if (category === 'artists' || category === 'playlists') {
          // Federated: YouTube Music's artists or playlists, and YouTube's channels or playlists.
          const [musicR, ytR] = await Promise.allSettled([
            searchMusicTyped(q, categoryToMusicFilter(category)),
            searchVideos({ query: q, contentType: category === 'artists' ? 'channel' : 'playlist' }),
          ]);
          if (!alive()) return;

          const b =
            musicR.status === 'fulfilled'
              ? bucketMusicSections(musicR.value.sections)
              : emptyBucket();
          const yt = ytR.status === 'fulfilled' ? videoSections(ytR.value) : null;
          musicContRef.current =
            musicR.status === 'fulfilled' ? musicR.value.continuation : null;
          setNext(Boolean(musicContRef.current));
          setResults(
            mergeMusicBucket(
              { ...emptyResults(), channels: yt?.channels ?? [], videoPlaylists: yt?.videoPlaylists ?? [] },
              category,
              b,
            ),
          );

          if (musicR.status === 'rejected' && ytR.status === 'rejected') {
            setError(getBackendErrorMessage(musicR.reason));
          }
          return;
        }

        const res = await searchMusicTyped(q, categoryToMusicFilter(category));
        if (!alive()) return;
        if (res.filters?.length) setOffered({ query: q, filters: res.filters });
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
    filters.contentType,
    filters.features,
    exact,
    execute,
  ]);

  const fetchNextPage = useCallback(() => {
    void execute('next');
  }, [execute]);

  const refetch = useCallback(() => {
    void execute('reset');
  }, [execute]);

  const searchExactly = useCallback(() => setExactQuery(queryRef.current), []);

  return {
    query: debouncedQuery,
    offeredMusicFilters: offered?.query === debouncedQuery ? offered.filters : null,
    filterType,
    setFilterType,
    sortBy,
    setSortBy,
    filters,
    setFilters,
    results,
    exact,
    searchExactly,
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
