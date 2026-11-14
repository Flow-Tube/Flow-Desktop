import { useEffect, useRef, useState } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import {
  SEEK_ZONE_FRACTION,
  seekRippleClipPath,
  type SeekDirection,
  type SeekFeedback as SeekFeedbackState,
} from "../../../lib/seekFeedback";

const SIDES: readonly SeekDirection[] = ["backward", "forward"];
const ZONE_WIDTH = `${SEEK_ZONE_FRACTION * 100}%`;

/** The player's size, read once and then only when it changes, so steps cost no layout reads. */
function useLayerSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const read = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      setSize((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/**
 * The tinted side and the chevrons that chase the seek. Every moving part animates only transform
 * and opacity in CSS, so a burst of clicks repaints without layout or per-frame script.
 */
export function SeekFeedback({ feedback, compact }: { feedback: SeekFeedbackState; compact: boolean }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useLayerSize(layerRef);
  const zoneWidth = width * SEEK_ZONE_FRACTION;
  const forward = feedback.direction === "forward";
  const Chevrons = forward ? ChevronsRight : ChevronsLeft;
  const label = getString(forward ? "player_seek_seconds_forward" : "player_seek_seconds_back", feedback.seconds);

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden="true">
      {SIDES.map((side) => {
        const active = feedback.visible && feedback.direction === side;
        return (
          <div
            key={side}
            className={`absolute inset-y-0 transition-opacity duration-200 ease-out ${side === "forward" ? "right-0" : "left-0"} ${
              active ? "opacity-100" : "opacity-0"
            }`}
            style={{ width: ZONE_WIDTH }}
          >
            <div
              key={active ? feedback.id : "idle"}
              className={`absolute inset-0 bg-chrome-white opacity-15 ${active ? "animate-seek-ripple" : ""}`}
              style={{ clipPath: seekRippleClipPath(zoneWidth, height, side) }}
            />
          </div>
        );
      })}

      <div
        key={feedback.direction}
        className={`absolute top-1/2 flex -translate-y-1/2 items-center gap-1 font-bold tabular-nums text-chrome-white transition-opacity duration-200 ease-out animate-seek-label-in ${
          compact ? "text-sm" : "text-lg"
        } ${forward ? (compact ? "right-4" : "right-12") : compact ? "left-4" : "left-12"} ${
          feedback.visible ? "opacity-100" : "opacity-0"
        }`}
      >
        {forward && <span>{label}</span>}
        <span className="animate-seek-chevron">
          <Chevrons
            size={compact ? 18 : 26}
            strokeWidth={2.4}
            className={forward ? "animate-seek-chevron-forward" : "animate-seek-chevron-backward"}
          />
        </span>
        {!forward && <span>{label}</span>}
      </div>
    </div>
  );
}
