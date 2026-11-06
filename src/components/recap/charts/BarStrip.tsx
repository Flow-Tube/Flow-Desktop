import { useState } from "react";

const WIDTH = 420;
const HEIGHT = 120;
const CORNER = 4;
const GAP = 2;

interface BarStripProps {
  values: number[];
  /** What each bar is, read out with its value on hover. */
  labels: string[];
  /** Text under the bars; an empty string leaves that slot blank. */
  axis?: string[];
  highlight?: number | null;
  format: (value: number) => string;
  /** Shown under the chart while no bar is hovered. */
  caption?: string;
  ariaLabel: string;
  onSelect?: (index: number) => void;
}

function barPath(x: number, width: number, height: number): string {
  const r = Math.min(CORNER, width / 2, height);
  const top = HEIGHT - height;
  return `M${x} ${HEIGHT}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + width - r}Q${x + width} ${top} ${x + width} ${top + r}V${HEIGHT}Z`;
}

/** One bar per slot on a shared baseline, drawn to scale; a slot at zero draws no bar. */
export function BarStrip({ values, labels, axis, highlight, format, caption, ariaLabel, onSelect }: BarStripProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const peak = Math.max(...values, 0);
  const slot = WIDTH / Math.max(values.length, 1);
  const barWidth = Math.max(slot - GAP, 1) * (values.length > 16 ? 1 : 0.7);
  const active = hovered ?? highlight ?? null;
  const readout = hovered !== null ? `${labels[hovered]} · ${format(values[hovered] ?? 0)}` : caption;

  return (
    <div className="flex flex-col gap-1.5">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={ariaLabel} className="block h-auto w-full" onMouseLeave={() => setHovered(null)}>
        <line x1={0} x2={WIDTH} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} className="stroke-outline-variant" />
        {values.map((value, index) => {
          const height = peak > 0 ? (value / peak) * HEIGHT : 0;
          const x = index * slot + (slot - barWidth) / 2;
          return (
            <g key={index}>
              {height > 0 && (
                <path d={barPath(x, barWidth, height)} className={index === active ? "fill-primary" : "fill-primary/40"} />
              )}
              <rect
                x={index * slot}
                y={0}
                width={slot}
                height={HEIGHT}
                fill="transparent"
                className={onSelect ? "cursor-pointer" : undefined}
                onMouseEnter={() => setHovered(index)}
                onClick={onSelect ? () => onSelect(index) : undefined}
              />
            </g>
          );
        })}
      </svg>
      {axis && (
        <div className="grid text-xs tabular-nums text-on-surface-variant" style={{ gridTemplateColumns: `repeat(${axis.length}, minmax(0, 1fr))` }}>
          {axis.map((text, index) =>
            onSelect ? (
              <button
                key={index}
                type="button"
                onClick={() => onSelect(index)}
                className="rounded-md py-0.5 text-center transition-colors duration-200 ease-out hover:bg-surface-container-highest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {text}
              </button>
            ) : (
              <span key={index} className="overflow-visible whitespace-nowrap text-center">{text}</span>
            ),
          )}
        </div>
      )}
      <p className="min-h-5 text-sm tabular-nums text-on-surface-variant">{readout}</p>
    </div>
  );
}
