import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";

import { IS_LINUX_RUNTIME } from "../../../lib/platform";
import type { MiniBarProgress } from "../../../lib/music/miniPlayerLook";
import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import { MusicScrubber } from "../MusicScrubber";

const EDGE_STROKE = 3;
const WAVE_LENGTH = 18;
const WAVE_HEIGHT = 3;

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

/** A wave along the bottom that moves while playing (still on Linux), seekable like the Line. */
function WavyProgress() {
  const share = useShare();
  const playing = useMusicPlayerStore((s) => s.isPlaying);
  const duration = useMusicPlayerStore((s) => s.duration);
  const seek = useMusicPlayerStore((s) => s.seek);
  const seekAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (duration > 0 && rect.width > 0) seek(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * duration);
  };
  const moving = playing && !IS_LINUX_RUNTIME;
  const wave = `M0 ${WAVE_HEIGHT + 1} ${Array.from({ length: 2 }, () => `q ${WAVE_LENGTH / 4} ${-WAVE_HEIGHT} ${WAVE_LENGTH / 2} 0 t ${WAVE_LENGTH / 2} 0`).join(" ")}`;
  const pattern = `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${WAVE_LENGTH * 2}' height='${WAVE_HEIGHT * 2 + 2}'><path d='${wave}' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round'/></svg>`,
  )}")`;
  const mask = { maskImage: pattern, WebkitMaskImage: pattern, maskRepeat: "repeat-x", WebkitMaskRepeat: "repeat-x" } as const;
  return (
    <div
      data-sheet-drag-ignore
      role="presentation"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        seekAt(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) seekAt(event);
      }}
      dir="ltr"
      className="group/wave absolute inset-x-7 bottom-0.5 h-3 cursor-pointer"
    >
      <span className={`absolute inset-0 bg-chrome-neutral-700/60 ${moving ? "animate-[mini-wave_1.2s_linear_infinite]" : ""}`} style={mask} />
      <span
        className={`absolute inset-y-0 start-0 bg-[var(--color-primary)] ${moving ? "animate-[mini-wave_1.2s_linear_infinite]" : ""}`}
        style={{ ...mask, width: `${share * 100}%` }}
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
      return <WavyProgress />;
    case "none":
      return null;
  }
}
