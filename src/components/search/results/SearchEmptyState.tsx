import { Search as SearchIcon } from 'lucide-react';
import { cx } from './ResultParts';

/** Nothing to show yet, nothing found, or an error. */
export function SearchEmptyState({
  title,
  body,
  tone = 'default',
}: {
  title: string;
  body: string;
  tone?: 'default' | 'error';
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-chrome-neutral-800 py-24 text-center">
      <SearchIcon className={cx('mb-4', tone === 'error' ? 'text-chrome-red-400/60' : 'text-chrome-neutral-700')} size={48} />
      <h3 className="font-semibold text-chrome-neutral-200">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-chrome-neutral-500">{body}</p>
    </div>
  );
}
