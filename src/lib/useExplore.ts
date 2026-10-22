import { useCallback, useEffect, useRef, useState } from 'react';
import { getExploreDestination, getExploreGrid, getExplorePage } from './api/youtube';
import { useBoolPref, usePreference } from './usePreference';
import { SETTINGS } from './settings/schema';
import type { StringKey } from './i18n/index';
import type {
  ExploreDestinationId,
  ExplorePage,
  ExploreShelf,
  ExploreTab,
  ExploreTarget,
  VideoSummary,
} from '../types/video';

export const EXPLORE_DESTINATIONS: { id: ExploreDestinationId; labelKey: StringKey }[] = [
  { id: 'live', labelKey: 'explore_category_live' },
  { id: 'gaming', labelKey: 'explore_category_gaming' },
  { id: 'music', labelKey: 'explore_category_music' },
  { id: 'news', labelKey: 'explore_category_news' },
  { id: 'sports', labelKey: 'explore_category_sports' },
  { id: 'learning', labelKey: 'explore_category_learning' },
  { id: 'fashion', labelKey: 'explore_category_fashion' },
];

const CACHE_TTL_MS = 10 * 60 * 1000;

/** A shelf opened in full: its grid so far, and the token for more. */
export interface ExploreSeeAll {
  title: string;
  target: ExploreTarget;
  videos: VideoSummary[];
  continuation: string | null;
  loading: boolean;
}

const pageCache = new Map<string, { page: ExplorePage; at: number }>();

/**
 * Explore's destinations, as Flow for Android shows them: a destination's shelves, its category
 * tabs (News has several), and a shelf's full grid behind "See all", paged on demand.
 */
export function useExplore() {
  const [destination, setDestination] = useState<ExploreDestinationId>('live');
  const [tab, setTab] = useState<ExploreTab | null>(null);
  const [page, setPage] = useState<ExplorePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<StringKey | null>(null);
  const [seeAll, setSeeAll] = useState<ExploreSeeAll | null>(null);
  const [nonce, setNonce] = useState(0);
  const [region, setRegion] = usePreference(SETTINGS.TRENDING_REGION, 'US');
  const [showRegionPicker] = useBoolPref(SETTINGS.SHOW_REGION_PICKER_IN_EXPLORE, true);
  const requestRef = useRef(0);

  const key = `${destination}:${tab?.target.params ?? ''}:${region}`;

  useEffect(() => {
    const cached = pageCache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      setPage(cached.page);
      setError(cached.page.shelves.length === 0 ? 'explore_empty_category' : null);
      setLoading(false);
      return;
    }
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    (tab ? getExplorePage(tab.target, region) : getExploreDestination(destination, region))
      .then((next) => {
        if (request !== requestRef.current) return;
        pageCache.set(key, { page: next, at: Date.now() });
        setPage(next);
        setError(next.shelves.length === 0 ? 'explore_empty_category' : null);
      })
      .catch((err) => {
        if (request !== requestRef.current) return;
        console.warn('Failed to load Explore', err);
        setPage(null);
        setError('explore_load_error');
      })
      .finally(() => {
        if (request === requestRef.current) setLoading(false);
      });
  }, [key, destination, tab, region, nonce]);

  const loadGrid = useCallback(
    (target: ExploreTarget, continuation: string | null) => {
      setSeeAll((current) => (current ? { ...current, loading: true } : current));
      getExploreGrid(continuation ? null : target, continuation, region)
        .then((grid) =>
          setSeeAll((current) =>
            current && current.target === target
              ? {
                  ...current,
                  videos: continuation ? [...current.videos, ...grid.videos] : grid.videos,
                  continuation: grid.continuation ?? null,
                  loading: false,
                }
              : current,
          ),
        )
        .catch((err) => {
          console.warn('Failed to load an Explore grid', err);
          setSeeAll((current) => (current && current.target === target ? { ...current, loading: false } : current));
        });
    },
    [region],
  );

  const openSeeAll = useCallback(
    (shelf: ExploreShelf) => {
      if (!shelf.more) return;
      setSeeAll({ title: shelf.title, target: shelf.more, videos: shelf.videos, continuation: null, loading: true });
      loadGrid(shelf.more, null);
    },
    [loadGrid],
  );

  const loadMoreSeeAll = useCallback(() => {
    if (seeAll && seeAll.continuation && !seeAll.loading) loadGrid(seeAll.target, seeAll.continuation);
  }, [seeAll, loadGrid]);

  const selectDestination = useCallback((id: ExploreDestinationId) => {
    setDestination(id);
    setTab(null);
    setSeeAll(null);
  }, []);

  const selectTab = useCallback((next: ExploreTab) => {
    setTab(next.selected ? null : next);
    setSeeAll(null);
  }, []);

  const refresh = useCallback(() => {
    pageCache.delete(key);
    setNonce((value) => value + 1);
  }, [key]);

  return {
    destination,
    selectDestination,
    activeTabTitle: tab?.title ?? page?.tabs.find((t) => t.selected)?.title ?? null,
    selectTab,
    region,
    setRegion,
    showRegionPicker,
    page,
    loading,
    error,
    seeAll,
    openSeeAll,
    closeSeeAll: () => setSeeAll(null),
    loadMoreSeeAll,
    refresh,
  };
}
