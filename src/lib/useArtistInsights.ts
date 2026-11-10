import { useEffect, useState } from 'react';

import { getMusicArtistInsights, type MusicArtistInsights } from './api/music';
import { getPlural, getString } from './i18n/index';

/** "Played 12 times · Liked". */
export function artistListeningLine(insights: Pick<MusicArtistInsights, 'plays' | 'liked'>): string {
  const plays = getPlural('music_artist_played_times', insights.plays);
  return insights.liked ? `${plays} · ${getString('music_artist_liked')}` : plays;
}

/** Your own listening for one artist. A failure only leaves it off the page. */
export function useArtistInsights(artistId: string | null, artistName: string | undefined) {
  const [insights, setInsights] = useState<MusicArtistInsights | null>(null);

  useEffect(() => {
    setInsights(null);
    if (!artistName) return;
    let cancelled = false;
    void getMusicArtistInsights(artistId, artistName)
      .then((next) => {
        if (!cancelled) setInsights(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [artistId, artistName]);

  return insights;
}
