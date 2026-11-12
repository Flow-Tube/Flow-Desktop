interface ThumbnailWatchProgressProps {
  /** Width of the bar, 0 to 100. */
  percent: number;
}

/** How far a video was watched, along the bottom of its thumbnail. */
export function ThumbnailWatchProgress({ percent }: ThumbnailWatchProgressProps) {
  const width = Math.min(100, Math.max(0, percent));
  return (
    <div className="absolute bottom-0 start-0 z-10 h-[3px] w-full bg-chrome-neutral-600" aria-hidden="true">
      <div className="h-full bg-primary" style={{ width: `${width}%` }} />
    </div>
  );
}
