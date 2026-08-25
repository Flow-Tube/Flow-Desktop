import React from 'react';
import { ChevronRight } from 'lucide-react';
import { getString } from '../../lib/i18n/index';

interface MusicShelfProps<T> {
  title: string;
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  onSeeAll?: () => void;
  loading?: boolean;
  skeletonShape?: 'square' | 'circle';
  skeletonCount?: number;
  className?: string;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function ShelfSkeleton({ shape }: { shape: 'square' | 'circle' }) {
  return (
    <div
      className={cx(
        'flex shrink-0 animate-pulse flex-col gap-3',
        shape === 'circle' ? 'w-32 md:w-40' : 'w-40 md:w-48 lg:w-56',
      )}
    >
      <div
        className={cx(
          'aspect-square w-full bg-surface-container-low',
          shape === 'circle' ? 'rounded-full' : 'rounded-xl',
        )}
      />
      <div className="h-3.5 w-3/4 rounded bg-surface-container-low" />
      {shape === 'square' ? <div className="h-3 w-1/2 rounded bg-surface-container-low" /> : null}
    </div>
  );
}

export function MusicShelf<T>({
  title,
  items,
  renderItem,
  onSeeAll,
  loading = false,
  skeletonShape = 'square',
  skeletonCount = 6,
  className,
}: MusicShelfProps<T>) {
  if (!loading && items.length === 0) return null;

  return (
    <section className={cx('flex flex-col', className)}>
      {(title || onSeeAll) && (
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-xl font-bold tracking-tight text-chrome-neutral-100">{title}</h2>
        {onSeeAll && (
          <button
            type="button"
            onClick={onSeeAll}
            className="group flex items-center gap-0.5 text-sm font-medium text-chrome-neutral-400 transition-colors duration-200 ease-out hover:text-chrome-neutral-100"
          >
            {getString('music_show_all')}
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        )}
      </div>
      )}

      <div className="flex snap-x gap-6 overflow-x-auto hide-scrollbar px-3 -mx-3 pt-3 -mt-2 pb-6">
        {loading
          ? Array.from({ length: skeletonCount }).map((_, i) => (
              <ShelfSkeleton key={i} shape={skeletonShape} />
            ))
          : items.map((item, i) => (
              <div key={i} className="snap-start shrink-0">
                {renderItem(item, i)}
              </div>
            ))}
      </div>
    </section>
  );
}

export default MusicShelf;
