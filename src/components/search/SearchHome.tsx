import { useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Clock, Gamepad2, GraduationCap, Music2, Newspaper, Radio, Shirt, Trophy, X } from 'lucide-react';
import { Chip } from '../ui/Chip';
import { getString } from '../../lib/i18n/index';
import { filterSummary } from '../../lib/searchFilterOptions';
import { HISTORY_WHEN_EMPTY } from '../../lib/searchSuggestions';
import { EXPLORE_DESTINATIONS } from '../../lib/useExplore';
import { useMusicEnabled } from '../../lib/useMusicContent';
import { useMusicMoods } from '../../lib/useMusicMoods';
import { musicSeeAllRoute } from '../../lib/musicRoutes';
import { useRunSearch } from '../../lib/useRunSearch';
import { formatTimeAgo } from '../../lib/timeAgo';
import { useSearchHistoryStore, useVisibleSearchHistory } from '../../store/useSearchHistoryStore';
import type { ExploreDestinationId } from '../../types/video';

const DESTINATION_ICONS: Record<ExploreDestinationId, ComponentType<{ className?: string }>> = {
  live: Radio,
  gaming: Gamepad2,
  music: Music2,
  news: Newspaper,
  sports: Trophy,
  learning: GraduationCap,
  fashion: Shirt,
};

const MAX_MOODS = 14;

function SectionTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between px-1">
      <h2 className="text-xl font-bold tracking-tight text-chrome-neutral-100">{title}</h2>
      {action}
    </div>
  );
}

const linkButton =
  'inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-sm font-medium text-chrome-neutral-400 transition-colors duration-200 ease-out hover:text-chrome-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

function RecentSearches() {
  const history = useVisibleSearchHistory();
  const remove = useSearchHistoryStore((s) => s.remove);
  const clear = useSearchHistoryStore((s) => s.clear);
  const runSearch = useRunSearch();
  const [showAll, setShowAll] = useState(false);
  if (history.length === 0) return null;
  const shown = showAll ? history : history.slice(0, HISTORY_WHEN_EMPTY);
  const now = Date.now();

  return (
    <section className="min-w-0">
      <SectionTitle
        title={getString('search_home_recent')}
        action={<button type="button" onClick={clear} className={linkButton}>{getString('search_clear_history')}</button>}
      />
      <ul className="flex flex-col rounded-2xl border border-outline-variant bg-surface-container-low p-1.5">
        {shown.map((entry) => {
          const summary = entry.filters ? filterSummary(entry.filters) : '';
          return (
            <li key={entry.query} className="group relative">
              <button
                type="button"
                onClick={() => runSearch(entry.query, entry.filters)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 pe-12 text-start transition-colors duration-200 ease-out hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Clock className="h-4 w-4 shrink-0 text-chrome-neutral-500" aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span dir="auto" className="truncate text-sm text-chrome-neutral-100">{entry.query}</span>
                  {summary && <span className="truncate text-xs text-chrome-neutral-400">{summary}</span>}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-chrome-neutral-500 transition-opacity group-hover:opacity-0">
                  {formatTimeAgo(entry.at, now)}
                </span>
              </button>
              <button
                type="button"
                aria-label={getString('search_remove_history')}
                title={getString('search_remove_history')}
                onClick={() => remove(entry.query)}
                className="absolute end-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-chrome-neutral-500 opacity-0 transition-opacity duration-200 ease-out hover:bg-surface-container-highest hover:text-chrome-neutral-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
        {history.length > shown.length && (
          <li>
            <button type="button" onClick={() => setShowAll(true)} className={`${linkButton} ms-9 my-1`}>
              {getString('search_history_show_all', history.length)}
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

function MoodChips() {
  const navigate = useNavigate();
  const { groups } = useMusicMoods();
  const moods = groups.flatMap((group) => group.items).slice(0, MAX_MOODS);
  if (moods.length === 0) return null;
  return (
    <section>
      <SectionTitle
        title={getString('search_home_moods')}
        action={
          <button type="button" onClick={() => navigate('/music/moods')} className={linkButton}>
            {getString('search_home_moods_all')}
            <ChevronRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
          </button>
        }
      />
      <div className="flex flex-wrap gap-2">
        {moods.map((mood) => (
          <Chip key={`${mood.browseId}:${mood.params ?? ''}`} onClick={() => navigate(musicSeeAllRoute(mood.browseId, mood.params, mood.title))}>
            <span dir="auto">{mood.title}</span>
          </Chip>
        ))}
      </div>
    </section>
  );
}

/** The search page before anything is typed: what you searched lately, and ways to browse. */
export function SearchHome() {
  const navigate = useNavigate();
  const musicEnabled = useMusicEnabled();

  return (
    <div className="flex flex-col gap-6 pb-12 pt-6">
      <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100">{getString('search_home_title')}</h1>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <RecentSearches />
        <div className="flex min-w-0 flex-col gap-8">
          <section>
            <SectionTitle title={getString('search_home_explore')} />
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {EXPLORE_DESTINATIONS.map((destination) => {
                const Icon = DESTINATION_ICONS[destination.id];
                return (
                  <button
                    key={destination.id}
                    type="button"
                    onClick={() => navigate(`/explore?d=${destination.id}`)}
                    className="flex h-16 items-center gap-3 rounded-2xl border border-outline-variant bg-surface-container-low px-4 text-start text-sm font-semibold text-chrome-neutral-100 transition-colors duration-200 ease-out hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-surface-container-high text-chrome-neutral-400">
                      <Icon className="h-4 w-4" />
                    </span>
                    {getString(destination.labelKey)}
                  </button>
                );
              })}
            </div>
          </section>
          {musicEnabled && <MoodChips />}
        </div>
      </div>
    </div>
  );
}
