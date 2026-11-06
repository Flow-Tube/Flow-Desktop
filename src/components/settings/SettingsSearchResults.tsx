import { SearchX } from 'lucide-react';

import { getString } from '../../lib/i18n/index';
import { SETTINGS_CATEGORY_LABELS, type SettingEntry } from '../../lib/settings/settingsIndex';

interface SettingsSearchResultsProps {
  results: SettingEntry[];
  onOpen: (entry: SettingEntry) => void;
}

export function SettingsSearchResults({ results, onOpen }: SettingsSearchResultsProps) {
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <SearchX className="h-8 w-8 text-chrome-neutral-500" aria-hidden="true" />
        <p className="text-sm text-chrome-neutral-400">{getString('settings_search_empty')}</p>
      </div>
    );
  }
  return (
    <ul className="mx-auto flex max-w-4xl flex-col gap-0.5 pb-8">
      {results.map((entry) => (
        <li key={`${entry.category}:${entry.title}`}>
          <button
            type="button"
            onClick={() => onOpen(entry)}
            className="w-full rounded-[4px] bg-surface-row px-5 py-3 text-start transition-colors duration-200 ease-out hover:bg-surface-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="block text-sm font-medium text-chrome-neutral-200">{getString(entry.title)}</span>
            {entry.summary && (
              <span className="mt-0.5 block text-xs text-chrome-neutral-400">{getString(entry.summary)}</span>
            )}
            <span className="mt-1 block text-xs text-primary">{getString(SETTINGS_CATEGORY_LABELS[entry.category])}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
