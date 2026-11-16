import type { ReactNode } from 'react';
import { RotateCcw, Search as SearchIcon, ShieldAlert, X } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { getString, type StringKey } from '../../../lib/i18n/index';
import { activeFilters } from '../../../lib/searchFilterOptions';
import { DEFAULT_ADVANCED_FILTERS } from '../../../lib/searchFilterState';
import type { AdvancedFilters } from '../../../lib/useCombinedSearch';
import { cx } from './ResultParts';

/** Nothing found, or an error, with what to do about it. */
export function SearchEmptyState({
  title,
  body,
  tone = 'default',
  children,
}: {
  title: string;
  body: string;
  tone?: 'default' | 'error';
  children?: ReactNode;
}) {
  const Icon = tone === 'error' ? ShieldAlert : SearchIcon;
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-3xl border border-dashed border-outline-variant px-6 py-20 text-center">
      <Icon className={cx('mb-3', tone === 'error' ? 'text-chrome-red-400/70' : 'text-chrome-neutral-700')} size={48} />
      <h3 className="font-semibold text-chrome-neutral-200">{title}</h3>
      <p className="max-w-sm text-sm text-chrome-neutral-500">{body}</p>
      {children && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </div>
  );
}

// Search fails for a few reasons worth naming apart; the rest show YouTube's own message.
const FAILURE_COPY: Record<string, [StringKey, StringKey]> = {
  botCheckRequired: ['search_error_bot_title', 'search_error_bot_hint'],
  rateLimited: ['player_error_rate_limited_title', 'player_error_rate_limited_hint'],
  network: ['player_error_network_title', 'player_error_network_hint'],
};

export function SearchFailure({ kind, message, onRetry }: { kind: string | null; message: string; onRetry: () => void }) {
  const copy = kind ? FAILURE_COPY[kind] : undefined;
  return (
    <SearchEmptyState
      tone="error"
      title={getString(copy?.[0] ?? 'search_error_title')}
      body={copy ? getString(copy[1]) : message}
    >
      <Button variant="primary" size="sm" onClick={onRetry}>
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        {getString('player_error_retry')}
      </Button>
    </SearchEmptyState>
  );
}

/** No results: when filters are on, they're the likely reason, so they can come off right here. */
export function SearchNoResults({
  query,
  filters,
  onFiltersChange,
}: {
  query: string;
  filters: AdvancedFilters | null;
  onFiltersChange: (filters: AdvancedFilters) => void;
}) {
  const active = filters ? activeFilters(filters) : [];
  if (!filters || active.length === 0) {
    return <SearchEmptyState title={getString('search_no_results_title', query)} body={getString('search_no_results_body')} />;
  }
  return (
    <SearchEmptyState title={getString('search_no_results_filtered_title')} body={getString('search_no_results_filtered_body', query)}>
      {active.map((filter) => (
        <Chip
          key={filter.key}
          active
          aria-label={getString('search_filters_remove', filter.label)}
          onClick={() => onFiltersChange(filter.without(filters))}
          className="gap-1 pe-2"
        >
          {filter.label}
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </Chip>
      ))}
      <Button variant="primary" size="sm" onClick={() => onFiltersChange(DEFAULT_ADVANCED_FILTERS)}>
        {getString('search_clear_filters')}
      </Button>
    </SearchEmptyState>
  );
}
