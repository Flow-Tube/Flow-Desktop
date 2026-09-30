import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getMusicChartsPage } from './api/music';
import type { MusicShelf } from '../types/music';

/**
 * Typed chart shelves for one country. Kept apart from the home feed so changing
 * the country only refetches charts. A failed request simply yields no shelves.
 */
export function useMusicCharts(country: string): MusicShelf[] {
  const { t } = useTranslation('common');
  const [shelves, setShelves] = useState<MusicShelf[]>([]);

  useEffect(() => {
    let active = true;
    getMusicChartsPage(undefined, country)
      .then((charts) => {
        if (!active) return;
        const label = charts.countryLabel ?? (charts.countryCode ? null : t('musicChartsGlobal'));
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
  }, [country, t]);

  return shelves;
}
