import { useGridStyle } from '../../../lib/useGridColumns';
import type { SearchCategory } from '../../../lib/useCombinedSearch';
import { RESULT_GRID, cx } from './ResultParts';

function ShimmerBlock({ className }: { className?: string }) {
  return <div className={cx('shimmer bg-surface-container-low', className)} />;
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-2">
          <ShimmerBlock className="h-12 w-12 shrink-0 rounded-md" />
          <div className="flex flex-1 flex-col gap-2">
            <ShimmerBlock className="h-3.5 w-1/3 rounded" />
            <ShimmerBlock className="h-3 w-1/4 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SkeletonCardGrid({ shape, count }: { shape: 'square' | 'circle' | 'video'; count: number }) {
  const gridStyle = useGridStyle({ density: shape === 'video' ? 'video' : 'dense' });
  const media =
    shape === 'video'
      ? 'aspect-video rounded-xl'
      : shape === 'circle'
        ? 'aspect-square rounded-full'
        : 'aspect-square rounded-xl';
  return (
    <div className={RESULT_GRID} style={gridStyle}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cx('flex flex-col gap-3', shape === 'circle' && 'items-center')}>
          <ShimmerBlock className={cx('w-full', media)} />
          <ShimmerBlock className="h-3.5 w-3/4 rounded" />
          <ShimmerBlock className="h-3 w-1/2 rounded" />
        </div>
      ))}
    </div>
  );
}

export function ResultsSkeleton({ filterType }: { filterType: SearchCategory }) {
  switch (filterType) {
    case 'songs':
    case 'episodes':
      return <SkeletonRows count={10} />;
    case 'videos':
    case 'live':
    case 'movies':
      return <SkeletonCardGrid shape="video" count={12} />;
    case 'playlists':
      return <SkeletonCardGrid shape="video" count={8} />;
    case 'albums':
    case 'podcasts':
      return <SkeletonCardGrid shape="square" count={12} />;
    case 'artists':
      return <SkeletonCardGrid shape="circle" count={12} />;
    case 'all':
    default:
      return (
        <div className="flex flex-col gap-10">
          <div className="flex items-center gap-5 rounded-2xl border border-chrome-neutral-800/50 bg-surface-container-low p-5">
            <ShimmerBlock className="h-28 w-28 shrink-0 rounded-xl" />
            <div className="flex flex-1 flex-col gap-3">
              <ShimmerBlock className="h-6 w-1/2 rounded" />
              <ShimmerBlock className="h-3.5 w-1/3 rounded" />
              <ShimmerBlock className="h-9 w-28 rounded-full" />
            </div>
          </div>
          <SkeletonRows count={4} />
          <SkeletonCardGrid shape="video" count={4} />
        </div>
      );
  }
}
