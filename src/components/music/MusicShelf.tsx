import React from 'react';
import { ShelfScroller } from '../ui/ShelfScroller';
import { MusicSectionHeader } from './MusicSectionHeader';
import type { MusicSeedArt } from '../../types/music';

interface MusicShelfProps<T> {
  title: string;
  /** Drawn as a strapline above the title. */
  subtitle?: string | null;
  seedArt?: MusicSeedArt | null;
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  onSeeAll?: () => void;
  onNavigate?: () => void;
  onPlayAll?: () => void;
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
  subtitle,
  seedArt,
  items,
  renderItem,
  onSeeAll,
  onNavigate,
  onPlayAll,
  loading = false,
  skeletonShape = 'square',
  skeletonCount = 6,
  className,
}: MusicShelfProps<T>) {
  if (!loading && items.length === 0) return null;

  return (
    <section className={cx('flex flex-col', className)}>
      {title && (
        <MusicSectionHeader
          title={title}
          strapline={subtitle}
          seedArt={seedArt}
          onNavigate={onNavigate}
          onPlayAll={onPlayAll}
          onSeeAll={onSeeAll}
        />
      )}

      <ShelfScroller className="flex snap-x gap-6 px-3 -mx-3 pt-3 -mt-2 pb-6">
        {loading
          ? Array.from({ length: skeletonCount }).map((_, i) => (
              <ShelfSkeleton key={i} shape={skeletonShape} />
            ))
          : items.map((item, i) => (
              <div key={i} className="snap-start shrink-0">
                {renderItem(item, i)}
              </div>
            ))}
      </ShelfScroller>
    </section>
  );
}

export default MusicShelf;
