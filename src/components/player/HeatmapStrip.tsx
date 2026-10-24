import { useMemo } from "react";
import { heatmapPath } from "../../lib/seekPreview";
import type { HeatmapMarker } from "../../types/video";

interface HeatmapStripProps {
  markers?: HeatmapMarker[];
  duration: number;
}

/** The most-replayed graph above the seek bar, shown while the pointer is over it. */
export function HeatmapStrip({ markers, duration }: HeatmapStripProps) {
  const path = useMemo(() => heatmapPath(markers, duration), [markers, duration]);
  if (!path) return null;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1000 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute bottom-[calc(50%+6px)] left-0 h-8 w-full opacity-0 transition-opacity duration-200 group-hover/seekbar:opacity-100"
    >
      <path d={path} className="fill-chrome-white/25" />
    </svg>
  );
}
