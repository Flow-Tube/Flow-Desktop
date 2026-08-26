import {
  Fragment,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { Virtualizer } from 'virtua';
import type { VideoSummary } from '../../types/video';
import { VideoCard } from './VideoCard';
import { SkeletonLoader } from '../ui/SkeletonLoader';
import { useGridStyle, useResolvedGridColumns } from '../../lib/useGridColumns';
import { useScrollContainer } from '../../lib/useScrollContainer';
import { createFrameScheduler } from '../../lib/frameScheduler';
import { chunkIntoRows } from '../../lib/gridRows';

interface VideoGridProps {
  videos?: VideoSummary[];
  loading?: boolean;
  skeletonCount?: number;
  onPlay: (video: VideoSummary) => void;
  onAddToQueue?: (video: VideoSummary) => void;
  onRemoveFromHistory?: (videoId: string) => void;
  /** Slotted in full-width directly under the first row of cards. */
  insertNode?: ReactNode;
  getVideoKey?: (video: VideoSummary, index: number) => string;
  variant?: "default" | "history";
  hideChannelAvatar?: boolean;
  /**
   * Mount only the rows near the viewport. For a feed that grows without bound;
   * opt-in because it requires this grid to own a whole stretch of the page's
   * scroll. Never set it on a grid nested inside another virtualizer (History's
   * `VList`) or on one of several stacked in a section (SearchResults).
   */
  virtualized?: boolean;
}

function VideoCardSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <SkeletonLoader type="thumbnail" />
      <div className="flex items-start gap-3 px-1">
        <SkeletonLoader type="avatar" className="shrink-0" />
        <div className="flex flex-col gap-2 w-full pt-1">
          <SkeletonLoader type="title" />
          <SkeletonLoader type="text" className="w-1/2" />
        </div>
      </div>
    </div>
  );
}

/*
  content-visibility lets the browser skip layout/paint for offscreen cards —
  feeds can hold hundreds, and Linux composites on the CPU. The p-2/-m-2 nets to
  zero but widens the containment paint clip past the card's own hover bleed, so
  the colour wash still has room at the peak of its expansion — even at two
  columns on a wide window.

  The virtualized path drops `flow-grid-card`: the rows near the viewport are the
  only ones mounted, so there is nothing offscreen left to skip, and an element
  with `content-visibility: auto` reports its `contain-intrinsic-size` placeholder
  rather than its real height — which is what the virtualizer measures rows with.
*/
const CARD_CELL = 'flow-grid-card p-2 -m-2';
const VIRTUAL_CARD_CELL = 'p-2 -m-2';

function VideoGridComponent({
  videos = [],
  loading = false,
  skeletonCount = 12,
  onPlay,
  onAddToQueue,
  onRemoveFromHistory,
  insertNode,
  getVideoKey,
  variant = "default",
  hideChannelAvatar,
  virtualized = false,
}: VideoGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const gridStyle = useGridStyle();
  const columns = useResolvedGridColumns(gridRef, gridStyle);
  const gridClass = "flow-grid gap-y-8 pb-8";

  /*
    The slot goes after the last card of the first row, whatever the resolved
    column count is — a fixed index would leave the row's leftovers stranded on
    a second row above the slot. -1 until the grid has been measured.
  */
  const insertAfterIndex = insertNode && columns > 0 ? Math.min(columns, videos.length) - 1 : -1;

  const renderCard = (video: VideoSummary, index: number, cellClass: string) => (
    <div key={getVideoKey ? getVideoKey(video, index) : `${video.id}-${index}`} className={cellClass}>
      <VideoCard
        video={video}
        onPlay={onPlay}
        onAddToQueue={onAddToQueue}
        onRemoveFromHistory={onRemoveFromHistory}
        variant={variant}
        hideChannelAvatar={hideChannelAvatar}
      />
    </div>
  );

  if (loading) {
    return (
      <div ref={gridRef} className={gridClass} style={gridStyle}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <VideoCardSkeleton key={`skeleton-${i}`} />
        ))}
      </div>
    );
  }

  if (virtualized) {
    return (
      <VirtualVideoGrid
        gridRef={gridRef}
        gridStyle={gridStyle}
        columns={columns}
        videos={videos}
        insertNode={insertNode}
        renderCard={renderCard}
      >
        {/* Fallback: the plain grid, rendered whenever virtualization cannot run. */}
        <div className={gridClass}>
          {videos.map((video, index) => (
            <Fragment key={getVideoKey ? getVideoKey(video, index) : `${video.id}-${index}`}>
              {renderCard(video, index, CARD_CELL)}
              {insertAfterIndex === index ? (
                <div className="col-span-full">{insertNode}</div>
              ) : null}
            </Fragment>
          ))}
        </div>
      </VirtualVideoGrid>
    );
  }

  return (
    <div ref={gridRef} className={gridClass} style={gridStyle}>
      {videos.map((video, index) => (
        <Fragment key={getVideoKey ? getVideoKey(video, index) : `${video.id}-${index}`}>
          {renderCard(video, index, CARD_CELL)}
          {insertAfterIndex === index ? (
            <div className="col-span-full">
              {insertNode}
            </div>
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}

interface VirtualVideoGridProps {
  gridRef: RefObject<HTMLDivElement | null>;
  gridStyle: CSSProperties;
  columns: number;
  videos: VideoSummary[];
  insertNode?: ReactNode;
  renderCard: (video: VideoSummary, index: number, cellClass: string) => ReactNode;
  /** Rendered instead whenever the grid cannot be virtualized. */
  children: ReactNode;
}

/**
 * Chunks the feed into rows and mounts only those near the viewport.
 *
 * Each row is its own `.flow-grid`, which lays out identically to the single
 * grid it replaces: `auto-fill` resolves the same track widths from the
 * container width alone, so a row — even a part-filled last one — gets the same
 * columns, and a row's `pb-8` reproduces the `gap-y-8` between rows exactly.
 *
 * Virtualization is an enhancement, never a requirement: if the column count has
 * not resolved yet or there is no scroll container to measure against, the plain
 * grid renders instead. A wrong answer there would be a blank feed, so the
 * fallback is the safe direction.
 */
function VirtualVideoGrid({
  gridRef,
  gridStyle,
  columns,
  videos,
  insertNode,
  renderCard,
  children,
}: VirtualVideoGridProps) {
  const scrollContainer = useScrollContainer();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [startMargin, setStartMargin] = useState(0);
  const schedulerRef = useRef<ReturnType<typeof createFrameScheduler> | null>(null);

  /*
    How far the rows begin below the top of the scrollport. The virtualizer
    places rows by scroll offset, so anything above them — the page's own
    padding, a header, a shelf — has to be accounted for or it windows the wrong
    rows. Measured rather than assumed, because it depends on whatever the page
    puts above the feed.
  */
  if (schedulerRef.current === null) {
    schedulerRef.current = createFrameScheduler(() => {
      const scroller = scrollContainer?.current;
      const wrapper = wrapperRef.current;
      if (!scroller || !wrapper) return;
      const offset =
        wrapper.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      setStartMargin((previous) => (Math.abs(previous - offset) < 1 ? previous : offset));
    });
  }
  const scheduleMeasure = schedulerRef.current.schedule;

  useEffect(() => {
    const scroller = scrollContainer?.current;
    if (!scroller) return;

    /*
      The scrollport's own size is the one geometry change worth observing: what
      moves the rows down is content *above* them, and observing the wrapper's
      box would not see that (its top moves while its size does not). Everything
      else is covered by the post-render re-measure below.
    */
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(scroller);
    window.addEventListener('resize', scheduleMeasure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [scrollContainer, scheduleMeasure]);

  // No dependency list: anything that re-renders the feed may also have changed
  // what sits above it. Coalesced to one read per frame.
  useEffect(scheduleMeasure);

  useEffect(() => {
    const scheduler = schedulerRef.current;
    return () => scheduler?.cancel();
  }, []);

  const rows = useMemo(
    () => chunkIntoRows(videos, columns, Boolean(insertNode)),
    [videos, columns, insertNode],
  );

  const canVirtualize = columns > 0 && Boolean(scrollContainer?.current) && rows.length > 0;

  return (
    <div style={gridStyle}>
      {/*
        Measurement probe. `auto-fill` resolves its track list from the container
        width alone, so an empty grid reports exactly the columns the real rows
        will use — and rows cannot be chunked until that count is known. Verified
        to agree with a populated grid at every width, including each point where
        a column is shed. Empty, so it occupies no height.
      */}
      <div ref={gridRef} className="flow-grid" aria-hidden />

      <div ref={wrapperRef}>
        {canVirtualize ? (
          <Virtualizer scrollRef={scrollContainer ?? undefined} startMargin={startMargin}>
            {rows.map((row) =>
              row.kind === 'slot' ? (
                <div key={row.key} className="pb-8">{insertNode}</div>
              ) : (
                <div key={row.key} className="flow-grid pb-8">
                  {row.items.map((video, index) =>
                    renderCard(video, row.offset + index, VIRTUAL_CARD_CELL),
                  )}
                </div>
              ),
            )}
          </Virtualizer>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/*
  The grid rebuilds an element per card, so a page that re-renders for an unrelated
  reason should not walk a feed of several hundred. Callers pass the play/queue
  handlers straight down from App, so the shallow compare holds.
*/
export const VideoGrid = memo(VideoGridComponent);
