import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getMusicHistory } from './api/db';
import {
  getMusicAlbumPage,
  getMusicChartsPage,
  getMusicDeepCuts,
  getMusicLinkedArtists,
  getMusicQueue,
  getMusicRediscover,
  getMusicTasteProfile,
  getMusicTimeRotation,
} from './api/music';
import {
  MIN_SHELF_ITEMS,
  chartCountry,
  isAudioSong,
  ranked,
  recallArtist,
  roundRobinReleases,
  songIdOf,
} from './musicRecall';
import { useLikesStore } from '../store/useLikesStore';
import type { PersonalSection } from './useMusicPersonalization';
import type { SongItem, YTItem } from '../types/music';

const SECTION_ORDER = [
  'listen-again', 'rotation', 'speed-dial', 'rediscover',
  'deep-cuts', 'artists-for-you', 'favorite-artist-albums',
];
const LISTEN_AGAIN_SIZE = 12;
const SPEED_DIAL_SIZE = 26;
const RELEASE_ANCHORS = 3;
const RELEASES_PER_KIND = 2;
const RELEASE_SHELF_SIZE = 12;
const DEEP_CUT_ALBUM_FETCHES = 2;

function uniqueAudio(songs: SongItem[], exclude: Set<string> = new Set()): SongItem[] {
  const seen = new Set(exclude);
  return songs.filter((song) => {
    const id = songIdOf(song);
    if (!isAudioSong(song) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Local-first home sections: Listen Again, Rotation, Speed Dial, Rediscover, Deep Cuts,
 * Artists for You and releases from favourite artists. Each publishes on its own as soon
 * as its source answers, and any failed source only removes its shelf.
 */
export function useMusicDiscoverySections(): PersonalSection[] {
  const { t } = useTranslation('common');
  const [sections, setSections] = useState<PersonalSection[]>([]);
  const requestRef = useRef(0);

  useEffect(() => {
    const request = ++requestRef.current;
    const live = () => requestRef.current === request;
    setSections([]);
    const publish = (section: PersonalSection | null) => {
      if (!section || !live() || section.items.length < MIN_SHELF_ITEMS) return;
      setSections((previous) => [...previous.filter((item) => item.id !== section.id), section]
        .sort((a, b) => SECTION_ORDER.indexOf(a.id) - SECTION_ORDER.indexOf(b.id)));
    };
    const songSection = (id: string, key: string, songs: SongItem[]): PersonalSection => ({
      id, title: t(key), items: songs.map((song): YTItem => ({ type: 'song', ...song })),
    });

    void getMusicTimeRotation(16)
      .then((songs) => publish(songSection('rotation', 'musicRotation', uniqueAudio(songs))))
      .catch(() => undefined);
    void getMusicRediscover(16)
      .then((songs) => publish(songSection('rediscover', 'musicRediscover', uniqueAudio(songs))))
      .catch(() => undefined);

    void (async () => {
      const history = await getMusicHistory(30, 0).catch(() => []);
      if (!live()) return;
      await useLikesStore.getState().load();
      const favorites = useLikesStore.getState().items
        .filter((item) => item.kind === 'music')
        .map((item) => item.song)
        .filter(isAudioSong);
      const ids = [...new Set([...history.map((item) => item.videoId), ...favorites.map(songIdOf)])]
        .filter(Boolean).slice(0, 30);
      if (!ids.length) return;
      const queue = await getMusicQueue(ids).catch(() => null);
      if (!queue || !live()) return;
      const byId = new Map(queue.items.map((song) => [songIdOf(song), song]));
      const listened = history.map((item) => byId.get(item.videoId)).filter((song): song is SongItem => !!song);
      const listenAgain = uniqueAudio(listened).slice(0, LISTEN_AGAIN_SIZE);
      publish(songSection('listen-again', 'musicListenAgain', listenAgain));
      // Speed Dial is the ranked long tail beyond what Listen Again already shows.
      const speedPool = uniqueAudio([...listened, ...favorites], new Set(listenAgain.map(songIdOf)));
      const speedDial = await ranked(speedPool, 'quick_picks');
      publish(songSection('speed-dial', 'musicSpeedDial', speedDial.slice(0, SPEED_DIAL_SIZE)));
    })();

    void (async () => {
      const profile = await getMusicTasteProfile().catch(() => null);
      if (!live()) return;
      const known = new Set(profile?.topArtists.map((artist) => artist.key) ?? []);
      const linked = await getMusicLinkedArtists(24).catch(() => []);
      const chartArtists = linked.length < MIN_SHELF_ITEMS
        ? (await getMusicChartsPage(undefined, chartCountry()).catch(() => null))?.sections
          .filter((section) => section.chartType === 'Artists')
          .flatMap((section) => section.items)
          .filter((item): item is Extract<YTItem, { type: 'artist' }> => item.type === 'artist') ?? []
        : [];
      const artists = [...new Map([...linked, ...chartArtists]
        .filter((artist) => !known.has(artist.id))
        .map((artist) => [artist.id, artist])).values()].slice(0, 16);
      publish({
        id: 'artists-for-you', title: t('musicArtistsForYou'),
        items: artists.map((artist) => ({ type: 'artist' as const, ...artist })),
      });

      const anchors = profile?.topArtists.filter((artist) => artist.idKeyed).slice(0, RELEASE_ANCHORS) ?? [];
      const pages = await Promise.all(anchors.map((artist) => recallArtist(artist.key)));
      if (!live()) return;
      const releases = roundRobinReleases(pages.map((page) => page
        ? [...page.albums.slice(0, RELEASES_PER_KIND), ...page.singles.slice(0, RELEASES_PER_KIND)]
        : []), RELEASE_SHELF_SIZE);
      publish({ id: 'favorite-artist-albums', title: t('musicFavoriteArtistAlbums'),
        items: releases.map((album) => ({ type: 'album' as const, ...album })) });

      // Opening two of those albums records their tracks in the content graph, which is
      // where Deep Cuts reads unheard tracks by the user's top artists from.
      await Promise.all(releases.slice(0, DEEP_CUT_ALBUM_FETCHES)
        .map((album) => getMusicAlbumPage(album.browseId, { preferCached: true }).catch(() => null)));
      if (!live()) return;
      const deepCuts = await getMusicDeepCuts(16).catch(() => []);
      publish(songSection('deep-cuts', 'musicDeepCuts', await ranked(uniqueAudio(deepCuts), 'discover')));
    })();

    return () => { requestRef.current += 1; };
  }, [t]);

  return sections;
}
