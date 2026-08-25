import { Fragment, useRef, type ReactNode } from 'react';
import type { VideoSummary } from '../../types/video';
import { VideoCard } from './VideoCard';
import { SkeletonLoader } from '../ui/SkeletonLoader';
import { useGridStyle, useResolvedGridColumns } from '../../lib/useGridColumns';

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

export function VideoGrid({
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
    <div ref={gridRef} className={gridClass} style={gridStyle}>
      {videos.map((video, index) => (
        <Fragment key={getVideoKey ? getVideoKey(video, index) : `${video.id}-${index}`}>
          {/*
            content-visibility lets the browser skip layout/paint for offscreen
            cards — feeds can hold hundreds, and Linux composites on the CPU.
            The p-2/-m-2 nets to zero but widens the containment paint clip
            past the card's own hover bleed, so the colour wash still has room
            at the peak of its expansion — even at two columns on a wide window.
          */}
          <div className="flow-grid-card p-2 -m-2">
            <VideoCard
              video={video}
              onPlay={onPlay}
              onAddToQueue={onAddToQueue}
              onRemoveFromHistory={onRemoveFromHistory}
              variant={variant}
              hideChannelAvatar={hideChannelAvatar}
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
