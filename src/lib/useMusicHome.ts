import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getCachedMusicHomePage,
  getMusicHomePage,
  getMusicMoodGenre,
  getMusicNewReleases,
} from './api/music';
import { getBackendErrorMessage } from './api/errors';
import { recordDiagnostic } from './diagnostics';
import { getString } from './i18n/index';
import type { AlbumItem, MusicHomeChip, MusicHomePage, MusicShelf, YTItem } from '../types/music';

export interface MusicHomeData {
  chips: MusicHomeChip[];
  sections: MusicShelf[];
}

export const MUSIC_HOME_CACHE_FRESH_MS = 4 * 60 * 60 * 1000;
/**
 * YouTube spreads its home over a few pages and the first holds only two or three
 * shelves, so the next pages load in the background once the first is on screen.
 */
const HOME_PREFETCH_PAGES = 2;

function sectionKey(section: MusicShelf): string {
  if (section.browseId) return `browse:${section.browseId}:${section.params ?? ''}`;
  const itemKeys = section.items.slice(0, 3).map((item) => {
    if ('id' in item) return item.id;
    if ('browseId' in item) return item.browseId;
    return '';
  });
  return `${section.title}:${itemKeys.join(',')}`;
}

/**
 * The Innertube music home: paints the typed SQLite cache first, refreshes it when
 * older than four hours, and keeps the last good page if the network fails. New
 * releases load independently; charts live in `useMusicCharts`.
 */
export function useMusicHome() {
  const [data, setData] = useState<MusicHomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const reqRef = useRef(0);
  const contRef = useRef<string | null>(null);
  const fromCacheRef = useRef(false);
  const sectionsRef = useRef<MusicShelf[]>([]);
  const releasesRef = useRef<MusicShelf | null>(null);
  const seenSectionsRef = useRef<Set<string>>(new Set());
  const chipsRef = useRef<MusicHomeChip[]>([]);
  const loadingMoreRef = useRef(false);
  const busyRef = useRef(false);
  const prefetchedRef = useRef(0);

  const publish = useCallback(() => {
    setData({
      chips: chipsRef.current,
      sections: releasesRef.current ? [...sectionsRef.current, releasesRef.current] : [...sectionsRef.current],
    });
  }, []);

  const addSections = useCallback((incoming: MusicShelf[]) => {
    for (const section of incoming) {
      const key = sectionKey(section);
      if (seenSectionsRef.current.has(key)) continue;
      seenSectionsRef.current.add(key);
      sectionsRef.current.push(section);
    }
  }, []);

  const applyHome = useCallback((home: MusicHomePage, fromCache: boolean) => {
    chipsRef.current = home.chips ?? [];
    sectionsRef.current = [];
    seenSectionsRef.current = new Set();
    addSections(home.sections ?? []);
    contRef.current = home.continuation ?? null;
    fromCacheRef.current = fromCache;
    publish();
  }, [addSections, publish]);

  const load = useCallback(async () => {
    const req = ++reqRef.current;
    const started = performance.now();
    busyRef.current = true;
    setLoading(true);
    setError(null);
    setLoadMoreError(null);
    setLoadingMore(false);
    contRef.current = null;
    prefetchedRef.current = 0;
    sectionsRef.current = [];
    releasesRef.current = null;
    seenSectionsRef.current = new Set();
    chipsRef.current = [];
    let painted = false;
    const markFirstContent = (source: 'cache' | 'network') => {
      if (painted) return;
      painted = true;
      setLoading(false);
      recordDiagnostic('music-home', `first content from ${source} in ${Math.round(performance.now() - started)}ms`);
    };

    void getMusicNewReleases().then((releases: AlbumItem[]) => {
      if (reqRef.current !== req || !releases.length) return;
      releasesRef.current = {
        title: getString('music_new_releases'),
        subtitle: null,
        browseId: null,
        params: null,
        source: 'newReleases',
        items: releases.map((album) => ({ type: 'album' as const, ...album })),
      };
      publish();
    }).catch(() => undefined);

    try {
      const cached = await getCachedMusicHomePage().catch(() => null);
      if (reqRef.current !== req) return;
      if (cached) {
        applyHome(cached.page, true);
        markFirstContent('cache');
      }
      const fresh = cached && Date.now() - cached.fetchedAt * 1000 < MUSIC_HOME_CACHE_FRESH_MS;
      if (!fresh) {
        try {
          const home = await getMusicHomePage();
          if (reqRef.current !== req) return;
          applyHome(home, false);
          markFirstContent('network');
        } catch (e) {
          if (reqRef.current === req) setError(getBackendErrorMessage(e));
        }
      }
    } finally {
      if (reqRef.current === req) {
        busyRef.current = false;
        setLoading(false);
      }
    }
  }, [applyHome, publish]);

  const loadMore = useCallback(async () => {
    if (busyRef.current || loadingMoreRef.current || !contRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    const req = reqRef.current;
    try {
      const more = await getMusicHomePage(contRef.current);
      if (reqRef.current !== req) return;
      contRef.current = more.continuation ?? null;
      addSections(more.sections ?? []);
      publish();
    } catch (e) {
      if (reqRef.current !== req) return;
      if (fromCacheRef.current) {
        // A cached page can carry an expired continuation; refetch the first page
        // for a live token instead of stranding the feed.
        try {
          const home = await getMusicHomePage();
          if (reqRef.current === req) applyHome(home, false);
        } catch (refreshError) {
          if (reqRef.current === req) setLoadMoreError(getBackendErrorMessage(refreshError));
        }
      } else {
        setLoadMoreError(getBackendErrorMessage(e));
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [addSections, applyHome, publish]);

  useEffect(() => {
    void load();
    return () => { reqRef.current += 1; };
  }, [load]);

  useEffect(() => {
    if (loading || loadingMore || !data || !contRef.current) return;
    if (prefetchedRef.current >= HOME_PREFETCH_PAGES) return;
    prefetchedRef.current += 1;
    void loadMore();
  }, [data, loading, loadingMore, loadMore]);

  return { data, loading, error, reload: load, loadMore, hasMore: !!contRef.current, loadingMore, loadMoreError };
}

export function useMusicChipFilter(chip: MusicHomeChip | null) {
  const [items, setItems] = useState<YTItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const reqRef = useRef(0);
  const contRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);

  const browseId = chip?.browseId ?? null;
  const params = chip?.params ?? null;

  useEffect(() => {
    const req = ++reqRef.current;
    contRef.current = null;
    if (!browseId) {
      setItems([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setItems([]);
    getMusicMoodGenre(browseId, params ?? undefined)
      .then((res) => {
        if (reqRef.current !== req) return;
        setItems(res.items);
        contRef.current = res.continuation ?? null;
      })
      .catch((e) => {
        if (reqRef.current === req) setError(getBackendErrorMessage(e));
      })
      .finally(() => {
        if (reqRef.current === req) setLoading(false);
      });
  }, [browseId, params, retryKey]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !contRef.current || !browseId) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const req = reqRef.current;
    try {
      const res = await getMusicMoodGenre(browseId, params ?? undefined, contRef.current);
      if (reqRef.current !== req) return;
      contRef.current = res.continuation ?? null;
      setItems((prev) => [...prev, ...res.items]);
    } catch (e) {
      if (reqRef.current === req) setError(getBackendErrorMessage(e));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [browseId, params]);

  return { items, loading, error, reload: () => setRetryKey((key) => key + 1), loadMore, hasMore: !!contRef.current, loadingMore };
}
