import { RotateCcw, X } from "lucide-react";

import { getString } from "../../../lib/i18n/index";

const STEPS = [-500, -100, 100, 500] as const;

const seconds = (ms: number): string => `${ms > 0 ? "+" : ""}${(ms / 1000).toFixed(1)}`;

const SEGMENT =
  "flex h-full min-w-0 flex-1 items-center justify-center bg-surface-container-high text-[11px] font-bold text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-surface-container-highest";

/**
 * Port of Android's LyricsSyncOffsetRow: ±0.1 s and ±0.5 s steps either side of the current
 * nudge, which resets the timing when tapped.
 */
export function LyricsSyncOffsetRow({
  offsetMs,
  onAdjust,
  onReset,
  onHide,
}: {
  offsetMs: number;
  onAdjust: (deltaMs: number) => void;
  onReset: () => void;
  onHide: () => void;
}) {
  const active = offsetMs !== 0;
  const value = getString("lyrics_sync_offset_value", active ? seconds(offsetMs) : "0");
  const step = (delta: number, edge: "start" | "inner" | "end") => (
    <button
      key={delta}
      type="button"
      onClick={() => onAdjust(delta)}
      aria-label={getString("lyrics_sync_step", seconds(delta))}
      className={`${SEGMENT} ${edge === "start" ? "rounded-l-full rounded-r-md" : edge === "end" ? "rounded-l-md rounded-r-full" : "rounded-md"}`}
    >
      {seconds(delta)}
    </button>
  );
  return (
    <div className="flex h-[52px] w-full items-center gap-2">
      <div className="flex h-full flex-1 items-center gap-0.5">
        {step(STEPS[0], "start")}
        {step(STEPS[1], "inner")}
        <button
          type="button"
          disabled={!active}
          onClick={onReset}
          aria-label={active ? getString("lyrics_sync_reset") : value}
          className={`flex h-full min-w-0 flex-[1.5] items-center justify-center gap-1 rounded-md text-xs font-bold transition-colors duration-200 ease-out ${
            active
              ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
              : "bg-surface-container text-chrome-neutral-400"
          }`}
        >
          <span aria-live="polite">{value}</span>
          {active && <RotateCcw className="h-3.5 w-3.5" aria-hidden />}
        </button>
        {step(STEPS[2], "inner")}
        {step(STEPS[3], "end")}
      </div>
      <button
        type="button"
        onClick={onHide}
        aria-label={getString("close")}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100"
      >
        <X className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}
