import { useMemo } from 'react';
import { ArrowLeft, Loader2, RefreshCcw, RotateCcw } from 'lucide-react';
import { CategoryChips } from '../components/layout/CategoryChips';
import { Button } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { IconButton } from '../components/ui/IconButton';
import { Select } from '../components/ui/Select';
import { VideoGrid } from '../components/video/VideoGrid';
import { getString } from '../lib/i18n/index';
import { EXPLORE_DESTINATIONS, useExplore } from '../lib/useExplore';
import { useInfiniteScroll } from '../lib/useInfiniteScroll';
import { REGION_OPTIONS } from '../lib/regionOptions';
import type { VideoSummary } from '../types/video';

type ExploreCategoriesProps = {
  onPlay: (video: VideoSummary) => void;
  onAddToQueue: (video: VideoSummary) => void;
};

/** A shelf shows two rows; "See all" opens the rest. */
const SHELF_PREVIEW = 8;

export default function ExploreCategories({ onPlay, onAddToQueue }: ExploreCategoriesProps) {
  const explore = useExplore();
  const { page, loading, error, seeAll, region } = explore;

  const sentinelRef = useInfiniteScroll({
    hasNextPage: Boolean(seeAll?.continuation),
    isLoading: Boolean(seeAll?.loading),
    onLoadMore: explore.loadMoreSeeAll,
  });

  const currentRegionLabel = useMemo(
    () => REGION_OPTIONS.find((option) => option.value === region)?.label ?? region,
    [region],
  );
  const destinations = EXPLORE_DESTINATIONS.map((destination) => ({ ...destination, label: getString(destination.labelKey) }));
  const activeLabel = destinations.find((destination) => destination.id === explore.destination)?.label ?? '';

  return (
    <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-5">
        <div className="flex flex-col gap-4 border-b border-chrome-neutral-800/50 pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
                {getString('explore_overline')}
              </p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight text-chrome-neutral-100">
                {page?.title || getString('explore_title')}
              </h1>
              <p className="mt-1 text-sm text-chrome-neutral-400">
                {getString('explore_subtitle', currentRegionLabel)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {explore.showRegionPicker && (
                <Select value={region} onChange={explore.setRegion} options={REGION_OPTIONS} className="w-48" />
              )}
              <IconButton
                aria-label={getString('refresh')}
                title={getString('refresh')}
                onClick={explore.refresh}
                disabled={loading}
                variant="secondary"
                size="sm"
              >
                {loading ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
              </IconButton>
            </div>
          </div>

          <CategoryChips
            sticky={false}
            categories={destinations.map((destination) => destination.label)}
            activeCategory={activeLabel}
            className="px-0 py-0"
            onCategoryChange={(label) => {
              const next = destinations.find((destination) => destination.label === label);
              if (next) explore.selectDestination(next.id);
            }}
          />

          {page && page.tabs.length > 1 && !seeAll && (
            <div className="flex flex-wrap gap-2">
              {page.tabs.map((tab) => (
                <Chip key={tab.title} active={tab.title === explore.activeTabTitle} onClick={() => explore.selectTab(tab)}>
                  {tab.title}
                </Chip>
              ))}
            </div>
          )}
        </div>

        {seeAll ? (
          <section className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <IconButton
                aria-label={getString('explore_back', page?.title || activeLabel)}
                title={getString('explore_back', page?.title || activeLabel)}
                onClick={explore.closeSeeAll}
                variant="secondary"
                size="sm"
              >
                <ArrowLeft />
              </IconButton>
              <h2 className="text-xl font-bold tracking-tight text-chrome-neutral-100">{seeAll.title}</h2>
            </div>
            <VideoGrid videos={seeAll.videos} onPlay={onPlay} onAddToQueue={onAddToQueue} />
            <div ref={sentinelRef} className="h-10" />
            {seeAll.loading && (
              <div className="flex justify-center py-6 text-chrome-neutral-500">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}
          </section>
        ) : loading ? (
          <VideoGrid loading skeletonCount={12} onPlay={onPlay} onAddToQueue={onAddToQueue} />
        ) : error ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-chrome-neutral-800 bg-surface-container-low p-8 text-center">
            <div>
              <h2 className="text-base font-medium text-chrome-neutral-200">{getString(error)}</h2>
              <p className="mt-1 text-sm text-chrome-neutral-400">{getString('explore_error_subtitle')}</p>
            </div>
            <Button type="button" onClick={explore.refresh}>
              <RotateCcw className="h-4 w-4" />
              {getString('retry')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-10 pb-12">
            {page?.shelves.map((shelf, index) => (
              <section key={`${shelf.title}-${index}`} className="flex flex-col">
                <div className="mb-3 flex items-center justify-between px-1">
                  <h2 className="text-xl font-bold tracking-tight text-chrome-neutral-100">{shelf.title}</h2>
                  {shelf.more && (
                    <button
                      type="button"
                      onClick={() => explore.openSeeAll(shelf)}
                      className="text-sm font-medium text-chrome-neutral-400 transition-colors duration-200 ease-out hover:text-chrome-neutral-100"
                    >
                      {getString('explore_see_all')}
                    </button>
                  )}
                </div>
                <VideoGrid
                  videos={page.shelves.length === 1 ? shelf.videos : shelf.videos.slice(0, SHELF_PREVIEW)}
                  onPlay={onPlay}
                  onAddToQueue={onAddToQueue}
                />
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
