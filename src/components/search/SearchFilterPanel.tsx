import { useEffect, useRef, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Button } from '../ui/Button';
import { getString } from '../../lib/i18n/index';
import {
  DURATION_OPTIONS,
  FEATURE_OPTIONS,
  UPLOAD_OPTIONS,
  WATCH_OPTIONS,
  type FilterOption,
} from '../../lib/searchFilterOptions';
import type { AdvancedFilters, SearchFeatureFilter } from '../../lib/useCombinedSearch';

interface SearchFilterPanelProps {
  filters: AdvancedFilters;
  onChange: (filters: AdvancedFilters) => void;
  onClose: () => void;
}

const optionClass = (selected: boolean) =>
  `flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start text-sm transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
    selected
      ? 'bg-surface-container-high font-semibold text-chrome-neutral-100'
      : 'text-chrome-neutral-300 hover:bg-surface-container hover:text-chrome-neutral-100'
  }`;

function Column({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <div role="group" aria-label={title} className={`min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
      <h3 className="mb-2 border-b border-outline-variant pb-1.5 text-xs font-semibold text-chrome-neutral-400">{title}</h3>
      <div className={wide ? 'grid grid-cols-2 gap-x-2' : 'flex flex-col'}>{children}</div>
    </div>
  );
}

function RadioColumn<T extends string>({
  title,
  options,
  value,
  onPick,
}: {
  title: string;
  options: FilterOption<T>[];
  value: T;
  onPick: (value: T) => void;
}) {
  return (
    <Column title={title}>
      <div role="radiogroup" aria-label={title} className="flex flex-col">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button key={option.value} type="button" role="radio" aria-checked={selected} onClick={() => onPick(option.value)} className={optionClass(selected)}>
              <span
                aria-hidden="true"
                className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border-[1.5px] ${selected ? 'border-chrome-neutral-100' : 'border-chrome-neutral-500'}`}
              >
                {selected && <span className="h-2 w-2 rounded-full bg-chrome-neutral-100" />}
              </span>
              {getString(option.labelKey)}
            </button>
          );
        })}
      </div>
    </Column>
  );
}

/** Every search filter at once. Each pick applies straight away; the toolbar shows what's on. */
export function SearchFilterPanel({ filters, onChange, onClose }: SearchFilterPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  }, []);

  const toggleFeature = (feature: SearchFeatureFilter) =>
    onChange({
      ...filters,
      features: filters.features.includes(feature)
        ? filters.features.filter((f) => f !== feature)
        : [...filters.features, feature],
    });

  return (
    <div
      ref={panelRef}
      id="search-filter-panel"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
      className="animate-menu-in flex flex-col gap-3 rounded-2xl border border-outline-variant bg-surface-container-low px-4 pb-3 pt-4"
    >
      <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-5">
        <RadioColumn
          title={getString('search_uploaded_label')}
          options={UPLOAD_OPTIONS}
          value={filters.uploadDate}
          onPick={(uploadDate) => onChange({ ...filters, uploadDate })}
        />
        <RadioColumn
          title={getString('search_length_label')}
          options={DURATION_OPTIONS}
          value={filters.duration}
          onPick={(duration) => onChange({ ...filters, duration })}
        />
        <Column title={getString('search_feature_label')} wide>
          {FEATURE_OPTIONS.map((option) => {
            const selected = filters.features.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                role="checkbox"
                aria-checked={selected}
                onClick={() => toggleFeature(option.value)}
                className={optionClass(selected)}
              >
                <span
                  aria-hidden="true"
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded border-[1.5px] ${
                    selected ? 'border-chrome-neutral-100 bg-chrome-neutral-100 text-background' : 'border-chrome-neutral-500'
                  }`}
                >
                  {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                {getString(option.labelKey)}
              </button>
            );
          })}
        </Column>
        <RadioColumn
          title={getString('search_watch_label')}
          options={WATCH_OPTIONS}
          value={filters.watchState}
          onPick={(watchState) => onChange({ ...filters, watchState })}
        />
      </div>
      <div className="flex items-center gap-3 border-t border-outline-variant pt-3">
        <p className="min-w-0 flex-1 text-xs text-chrome-neutral-400">{getString('search_filters_hint')}</p>
        <Button variant="secondary" size="sm" onClick={onClose}>
          {getString('search_filters_done')}
        </Button>
      </div>
    </div>
  );
}
