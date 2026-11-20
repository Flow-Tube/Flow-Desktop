import { useEffect, useState } from "react";
import { ZoomIn } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import { useZoomReadout, type VideoZoom } from "../../../lib/player/useVideoZoom";

/** As on Android: the read-out lingers a little longer while zoomed than after going back to 1x. */
const ZOOMED_MS = 900;
const UNZOOMED_MS = 600;

/** "2.4×" or "Fills the screen" for a moment after each zoom change. */
export function ZoomReadout({ zoom }: { zoom: VideoZoom }) {
  const readout = useZoomReadout(zoom);
  const [hiddenId, setHiddenId] = useState<number | null>(null);

  useEffect(() => {
    if (!readout) return;
    const timer = window.setTimeout(() => setHiddenId(readout.id), readout.scale > 1 ? ZOOMED_MS : UNZOOMED_MS);
    return () => window.clearTimeout(timer);
  }, [readout]);

  if (!readout || hiddenId === readout.id) return null;
  const label = readout.atFill
    ? getString("player_zoom_fills_screen")
    : getString("player_zoom_level", readout.scale.toFixed(1));
  return (
    <div className="pointer-events-none absolute left-1/2 top-8 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-chrome-black/60 px-4 py-2 text-sm font-bold tabular-nums text-chrome-white animate-fade-in">
      <ZoomIn size={16} />
      {label}
    </div>
  );
}
