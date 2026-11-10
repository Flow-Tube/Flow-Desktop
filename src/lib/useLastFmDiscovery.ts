import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getScrobbleStatus } from './api/scrobble';
import { getString } from './i18n/index';
import { lastFmDiscoverySongs } from './lastFmDiscovery';
import type { PersonalSection } from './useMusicPersonalization';
import type { SongItem } from '../types/music';

/**
 * The Last.fm shelf, only for listeners signed in to it. `request` asks for its songs once, when
 * the end of the home comes into view; a failure just leaves the shelf out.
 */
export function useLastFmDiscovery(enabled: boolean) {
  const [signedIn, setSignedIn] = useState(false);
  const [songs, setSongs] = useState<SongItem[]>([]);
  const requestedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void getScrobbleStatus()
      .then((status) => {
        if (cancelled) return;
        setSignedIn(status.services.some((service) => service.service === 'LASTFM' && service.signedIn));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const available = enabled && signedIn;

  const request = useCallback(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    void lastFmDiscoverySongs().then(setSongs).catch(() => undefined);
  }, []);

  const sections = useMemo<PersonalSection[]>(() => {
    if (!available || songs.length === 0) return [];
    return [{
      id: 'lastfm-discover',
      title: getString('music_home_lastfm_discover'),
      subtitle: getString('music_home_lastfm_discover_subtitle'),
      items: songs.map((song) => ({ type: 'song' as const, ...song })),
    }];
  }, [available, songs]);

  return { available, request, sections };
}
