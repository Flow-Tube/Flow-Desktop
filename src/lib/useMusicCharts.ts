import { getString } from './i18n/index';
import { useEffect, useState } from 'react';

import { getMusicChartsPage } from './api/music';
import type { MusicShelf } from '../types/music';

/**
 * Typed chart shelves for one country. Kept apart from the home feed so changing
 * the country only refetches charts. A failed request simply yields no shelves.
 */
export function useMusicCharts(country: string): MusicShelf[] {
  const [shelves, setShelves] = useState<MusicShelf[]>([]);

  useEffect(() => {
    let active = true;
    getMusicChartsPage(undefined, country)
      .then((charts) => {
        if (!active) return;
        const label = charts.countryLabel ?? (charts.countryCode ? null : getString('music_charts_global'));
        setShelves(charts.sections.map((section) => ({
          title: section.title,
          subtitle: label,
          browseId: null,
          params: null,
          source: `chart${section.chartType}`,
          items: section.items,
        })));
      })
      .catch(() => {
        if (active) setShelves([]);
      });
    return () => { active = false; };
  }, [country]);

  return shelves;
}
