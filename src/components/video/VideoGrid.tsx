import { Fragment, memo, useRef, type ReactNode } from 'react';
import type { VideoSummary } from '../../types/video';
import { VideoCard } from './VideoCard';
import { SkeletonLoader } from '../ui/SkeletonLoader';
import { useGridStyle, useResolvedGridColumns } from '../../lib/useGridColumns';
import { IMPRESSION_ATTRIBUTE, useFeedImpressions } from '../../lib/useFeedImpressions';
import { GRID_INDEX_ATTRIBUTE, useLastVisibleCard } from '../../lib/useLastVisibleCard';
import { thumbnailNeedsHighRes } from '../../lib/thumbnails';

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
  /** Counts cards the viewer actually sees as feed impressions for the recommendation engine. */
  trackImpressions?: boolean;
  /** Why a feed shows a card, offered in its menu. */
  getReason?: (video: VideoSummary) => string | undefined;
  /** A line shown on the card itself, for the few reasons worth saying up front. */
  getReasonLine?: (video: VideoSummary) => string | undefined;
  /** The position of the last card on screen, for a feed that pages as it nears the end. */
  onLastVisibleIndex?: (index: number) => void;
  /** Rows of the list card instead of the grid. */
  listLayout?: boolean;
}

/**
 * The card the slot follows: the end of the first row, whatever the resolved column count is, so a
 * fixed index cannot strand the row's leftovers on a second row above it. -1 while a grid is not
 * measured yet; a list always has one column.
 */
export function insertAfterCard(hasSlot: boolean, columns: number, cardCount: number, listLayout: boolean): number {
  if (!hasSlot) return -1;
  if (listLayout) return 0;
  return columns > 0 ? Math.min(columns, cardCount) - 1 : -1;
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
  trackImpressions = false,
  getReason,
  getReasonLine,
  onLastVisibleIndex,
  listLayout = false,
}: VideoGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  useFeedImpressions(gridRef, videos, trackImpressions && !loading);
  useLastVisibleCard(gridRef, loading ? 0 : videos.length, onLastVisibleIndex);
  const gridStyle = useGridStyle();
  const { columns, trackWidth } = useResolvedGridColumns(gridRef, gridStyle);
  // Few columns or a wide window can stretch a card past `hqdefault` even on a 1× screen.
  const highResThumbnails = trackWidth > 0 ? thumbnailNeedsHighRes(trackWidth) : undefined;
  const gridClass = "flow-grid gap-y-8 pb-8";

  const insertAfterIndex = insertAfterCard(Boolean(insertNode), columns, videos.length, listLayout);

  if (loading) {
    return (
      <div ref={gridRef} className={gridClass} style={gridStyle}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <VideoCardSkeleton key={`skeleton-${i}`} />
        ))}
      </div>
    );
  }

  return (
    <div
      ref={gridRef}
      className={listLayout ? "flex flex-col gap-1 pb-8" : gridClass}
      style={listLayout ? undefined : gridStyle}
    >
      {videos.map((video, index) => (
        <Fragment key={getVideoKey ? getVideoKey(video, index) : `${video.id}-${index}`}>
          {/*
            content-visibility lets the browser skip layout/paint for offscreen
            cards — feeds can hold hundreds, and Linux composites on the CPU.
            The p-2/-m-2 nets to zero but widens the containment paint clip
            past the card's own hover bleed, so the colour wash still has room
            at the peak of its expansion — even at two columns on a wide window.
          */}
          <div
            className={listLayout ? undefined : "flow-grid-card p-2 -m-2"}
            {...(trackImpressions ? { [IMPRESSION_ATTRIBUTE]: video.id } : {})}
            {...(onLastVisibleIndex ? { [GRID_INDEX_ATTRIBUTE]: index } : {})}
          >
            <VideoCard
              video={video}
              onPlay={onPlay}
              onAddToQueue={onAddToQueue}
              onRemoveFromHistory={onRemoveFromHistory}
              variant={listLayout ? "list" : variant}
              hideChannelAvatar={hideChannelAvatar}
              reason={getReason?.(video)}
              reasonLine={getReasonLine?.(video)}
              highResThumbnail={highResThumbnails}
            />
          </div>
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

/*
  The grid rebuilds an element per card, so a page that re-renders for an unrelated
  reason should not walk a feed of several hundred. Callers pass the play/queue
  handlers straight down from App, so the shallow compare holds.
*/
export const VideoGrid = memo(VideoGridComponent);
