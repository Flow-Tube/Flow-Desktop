import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";

import type { MiniBarProgress } from "../../../lib/music/miniPlayerLook";
import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import { MusicScrubber } from "../MusicScrubber";
import { SQUIGGLY_MINI, SquigglyCanvas } from "../../ui/SquigglyCanvas";

const EDGE_STROKE = 3;

function useShare(): number {
  const progress = useMusicPlayerStore((s) => s.progress);
  const duration = useMusicPlayerStore((s) => s.duration);
  return duration > 0 ? Math.min(1, Math.max(0, progress / duration)) : 0;
}

/** A tint growing from the start edge, as Android's Fill. */
function FillProgress() {
  const share = useShare();
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-y-0 start-0 -z-10 bg-[color-mix(in_srgb,var(--color-primary)_22%,transparent)]"
      style={{ width: `${share * 100}%` }}
    />
  );
}

/** A line running round the pill from its top centre, clockwise (anticlockwise right to left). */
function EdgeProgress() {
  const share = useShare();
  const ref = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  const inset = EDGE_STROKE / 2;
  const width = Math.max(0, box.width - EDGE_STROKE);
  const height = Math.max(0, box.height - EDGE_STROKE);
  const radius = height / 2;
  // From the top centre round to the top centre again, so the run starts where Android's does.
  const top = inset;
  const mid = inset + width / 2;
  const path = `M ${mid} ${top} H ${inset + width - radius} A ${radius} ${radius} 0 0 1 ${inset + width - radius} ${top + height} H ${inset + radius} A ${radius} ${radius} 0 0 1 ${inset + radius} ${top} Z`;
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  return (
    <svg ref={ref} aria-hidden className="pointer-events-none absolute inset-0 z-10 h-full w-full" style={rtl ? { transform: "scaleX(-1)" } : undefined}>
      {width > 0 && (
        <>
          <path d={path} fill="none" strokeWidth={EDGE_STROKE} pathLength={100} className="stroke-chrome-neutral-700/60" />
          <path
            d={path}
            fill="none"
            strokeWidth={EDGE_STROKE}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${share * 100} 100`}
            className="stroke-[var(--color-primary)]"
          />
        </>
      )}
    </svg>
  );
}

/** Android's Squiggly along the bottom, seekable like the Line; its thumb shows on hover. */
function SquigglyProgress() {
  const share = useShare();
  const playing = useMusicPlayerStore((s) => s.isPlaying);
  const duration = useMusicPlayerStore((s) => s.duration);
  const seek = useMusicPlayerStore((s) => s.seek);
  const [hovered, setHovered] = useState(false);
  const [dragShare, setDragShare] = useState<number | null>(null);
  const shareAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return rect.width > 0 ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0;
  };
  return (
    <div
      data-sheet-drag-ignore
      role="presentation"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={(event) => {
        if (duration <= 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDragShare(shareAt(event));
      }}
      onPointerMove={(event) => {
        if (dragShare !== null) setDragShare(shareAt(event));
      }}
      onPointerUp={(event) => {
        if (dragShare === null) return;
        // One seek on release, as the full player's bar does: each seek refetches the audio.
        seek(shareAt(event) * duration);
        setDragShare(null);
      }}
      onPointerCancel={() => setDragShare(null)}
      dir="ltr"
      className="absolute inset-x-6 bottom-0 h-3 cursor-pointer"
    >
      <SquigglyCanvas
        className="h-3 w-full"
        ratio={dragShare ?? share}
        playing={playing}
        pressed={hovered || dragShare !== null}
        still={dragShare !== null}
        look={SQUIGGLY_MINI}
      />
    </div>
  );
}

/** The song's progress on the Pill, in the style chosen in Settings. */
export function BarProgress({ style }: { style: MiniBarProgress }) {
  switch (style) {
    case "fill":
      return <FillProgress />;
    case "edge":
      return <EdgeProgress />;
    case "line":
      return (
        <div data-sheet-drag-ignore className="absolute inset-x-7 bottom-1">
          <MusicScrubber variant="edge" />
        </div>
      );
    case "wavy_line":
      return <SquigglyProgress />;
    case "none":
      return null;
  }
}
