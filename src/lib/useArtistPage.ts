import { useCallback, useEffect, useRef, useState } from 'react';
import { getMusicArtistItems, getMusicArtistPage } from './api/music';
import { getBackendErrorMessage } from './api/errors';
import type {
  AlbumItem,
  ArtistItem,
  ArtistPage,
  ArtistSection,
  MusicWatchTarget,
  PlaylistItem,
  SongItem,
  YTItem,
} from '../types/music';

export interface ArtistMoreEndpoint {
  browseId: string | null;
  params: string | null;
}

export interface ArtistHeader {
  id: string;
  title: string;
  thumbnail: string | null;
  subscriberCountText: string | null;
  monthlyListenerCount: string | null;
  isSubscribed: boolean;
}

/** A link out of the artist's bio, labelled by the text it covers. */
export interface ArtistAboutLink {
  label: string;
  url: string;
}

export interface ArtistPageData {
  header: ArtistHeader;
  about: string | null;
  aboutLinks: ArtistAboutLink[];
  shuffle: MusicWatchTarget | null;
  radio: MusicWatchTarget | null;
  topSongs: SongItem[];
  topSongsMore: ArtistMoreEndpoint | null;
  albums: AlbumItem[];
  albumsMore: ArtistMoreEndpoint | null;
  singles: AlbumItem[];
  singlesMore: ArtistMoreEndpoint | null;
  videos: SongItem[];
  related: ArtistItem[];
  featuredOn: PlaylistItem[];
}

type ItemOf<T extends YTItem['type']> = Extract<YTItem, { type: T }>;

const pick = <T extends YTItem['type']>(items: YTItem[], type: T): ItemOf<T>[] =>
  items.filter((i): i is ItemOf<T> => i.type === type);

const moreOf = (s: ArtistSection): ArtistMoreEndpoint | null =>
  s.moreEndpointBrowseId || s.moreEndpointParams
    ? { browseId: s.moreEndpointBrowseId, params: s.moreEndpointParams }
    : null;

export function segmentArtistPage(page: ArtistPage): ArtistPageData {
  const data: ArtistPageData = {
    header: {
      id: page.artist.id,
      title: page.artist.title,
      thumbnail: page.artist.thumbnail,
      subscriberCountText: page.subscriberCountText,
      monthlyListenerCount: page.monthlyListenerCount,
      isSubscribed: page.isSubscribed,
    },
    about: page.description?.trim() || null,
    aboutLinks: (page.descriptionLinks ?? [])
      .map((link) => ({ label: (page.description ?? '').slice(link.start, link.end).trim(), url: link.url }))
      .filter((link) => link.label.length > 0),
    shuffle: page.shuffle ?? null,
    radio: page.radio ?? null,
    topSongs: [],
    topSongsMore: null,
    albums: [],
    albumsMore: null,
    singles: [],
    singlesMore: null,
    videos: [],
    related: [],
    featuredOn: [],
  };

  // Sections are told apart by the kind the backend read from their structure,
  // never by their titles, which are localised.
  for (const section of page.sections) {
    switch (section.kind) {
      case 'topSongs':
        if (data.topSongs.length) break;
        data.topSongs = pick(section.items, 'song');
        data.topSongsMore = moreOf(section);
        break;
      case 'albums':
        if (data.albums.length) break;
        data.albums = pick(section.items, 'album');
        data.albumsMore = moreOf(section);
        break;
      case 'singles':
        if (data.singles.length) break;
        data.singles = pick(section.items, 'album');
        data.singlesMore = moreOf(section);
        break;
      case 'videos':
        if (!data.videos.length) data.videos = pick(section.items, 'song');
        break;
      case 'relatedArtists':
        if (!data.related.length) data.related = pick(section.items, 'artist');
        break;
      case 'featuredOn':
        if (!data.featuredOn.length) data.featuredOn = pick(section.items, 'playlist');
        break;
    }
  }

  return data;
}

export function useArtistPage(browseId: string | undefined) {
  const [data, setData] = useState<ArtistPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    if (!browseId) {
      setLoading(false);
      setError(getBackendErrorMessage(new Error('missing artist id')));
      return;
    }
    const req = ++reqRef.current;
    setLoading(true);
    setError(null);
    try {
      const page = await getMusicArtistPage(browseId);
      if (reqRef.current !== req) return;
      setData(segmentArtistPage(page));
    } catch (e) {
      if (reqRef.current === req) {
        setError(getBackendErrorMessage(e));
        setData(null);
      }
    } finally {
      if (reqRef.current === req) setLoading(false);
    }
  }, [browseId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload: load };
}

export function useArtistItems(browseId: string | undefined, params: string | undefined) {
  const [items, setItems] = useState<YTItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqRef = useRef(0);
  const contRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    const req = ++reqRef.current;
    contRef.current = null;
    if (!browseId) {
      setItems([]);
      setError(getBackendErrorMessage(new Error('missing browse id')));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setItems([]);
    getMusicArtistItems(browseId, params ?? undefined)
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
  }, [browseId, params]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !contRef.current || !browseId) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const req = reqRef.current;
    try {
      const res = await getMusicArtistItems(browseId, params ?? undefined, contRef.current);
      if (reqRef.current !== req) return;
      contRef.current = res.continuation ?? null;
      setItems((prev) => [...prev, ...res.items]);
    } catch {
      contRef.current = null;
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [browseId, params]);

  return { items, loading, loadingMore, error, loadMore, hasMore: !!contRef.current };
}
