import { useRef, useState } from "react";
import type React from "react";

import { getString } from "../../lib/i18n/index";
import { formatTime } from "../../lib/musicFormat";

interface MediaScrubberProps {
  progress: number;
  duration: number;
  onSeek: (seconds: number) => void;
  size?: "sm" | "lg";
  variant?: "bar" | "edge";
  showTimes?: boolean;
  countdown?: boolean;
  ariaLabel?: string;
  className?: string;
}

export function MediaScrubber({
  progress,
  duration,
  onSeek,
  size = "sm",
  variant = "bar",
  showTimes = false,
  countdown = false,
  ariaLabel = getString("music_seek"),
  className = "",
}: MediaScrubberProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragRatio, setDragRatio] = useState(0);

  const liveRatio = duration > 0 ? Math.min(1, Math.max(0, progress / duration)) : 0;
  const ratio = dragging ? dragRatio : liveRatio;
  const pct = ratio * 100;

  const ratioFromClientX = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = ratioFromClientX(e.clientX);
    setDragging(true);
    setDragRatio(r);
    onSeek(r * duration);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || duration <= 0) return;
    const r = ratioFromClientX(e.clientX);
    setDragRatio(r);
    onSeek(r * duration);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    setDragging(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      onSeek(Math.min(duration, progress + 5));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      onSeek(Math.max(0, progress - 5));
    }
  };

  const isEdge = variant === "edge";
  const isLg = size === "lg";

  const hitH = isEdge ? "h-4 items-end" : isLg ? "h-5 items-center" : "h-4 items-center";
  const trackH = isEdge
    ? dragging
      ? "h-1.5"
      : "h-[2px] transition-[height] duration-150 ease-out group-hover/scrub:h-1.5"
    : "h-1";
  const trackShape = isEdge ? "bg-chrome-neutral-800" : "rounded-full bg-chrome-neutral-800";
  const fillShape = isEdge ? "" : "rounded-full";
  const thumbSize = isEdge ? "h-2 w-2" : isLg ? "h-3.5 w-3.5" : "h-3 w-3";
  const thumbPosition = isEdge
    ? "bottom-[3px] translate-y-1/2"
    : "top-1/2 -translate-y-1/2";

  const bar = (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(ratio * duration)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className={`group/scrub relative flex ${hitH} flex-1 cursor-pointer touch-none outline-none`}
    >
      <div className={`relative ${trackH} w-full overflow-hidden ${trackShape}`}>
        <div
          className={`absolute inset-y-0 left-0 bg-[var(--color-primary)] ${fillShape}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={`pointer-events-none absolute ${thumbPosition} ${thumbSize} -translate-x-1/2 rounded-full bg-chrome-white transition-opacity duration-150 ${
          dragging ? "opacity-100" : "opacity-0 group-hover/scrub:opacity-100"
        }`}
        style={{ left: `${pct}%` }}
      />
    </div>
  );

  if (isEdge || !showTimes) {
    return <div className={`flex w-full items-center ${className}`}>{bar}</div>;
  }

  const rightLabel = countdown
    ? `-${formatTime(Math.max(0, duration - ratio * duration))}`
    : formatTime(duration);

  return (
    <div className={`flex w-full items-center gap-3 ${className}`}>
      <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-chrome-neutral-400">
        {formatTime(ratio * duration)}
      </span>
      {bar}
      <span className="w-10 shrink-0 font-mono text-xs tabular-nums text-chrome-neutral-400">
        {rightLabel}
      </span>
    </div>
  );
}
