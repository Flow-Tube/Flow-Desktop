import { useState } from "react";

import { hourLabel } from "../../../lib/recap/recapFormat";

const SIZE = 240;
const CENTER = SIZE / 2;
const INNER = 52;
const OUTER = 100;
const LABEL = 113;
const HOUR_MARKS = [0, 6, 12, 18];

function point(hour: number, radius: number): [number, number] {
  const angle = (hour / 24) * 2 * Math.PI - Math.PI / 2;
  return [CENTER + Math.cos(angle) * radius, CENTER + Math.sin(angle) * radius];
}

interface ClockChartProps {
  hourCounts: number[];
  ariaLabel: string;
}

/** A 24-hour dial with midnight at the top: each spoke's length is that hour's share of the peak. */
export function ClockChart({ hourCounts, ariaLabel }: ClockChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const peak = Math.max(...hourCounts, 0);
  const busiest = peak > 0 ? hourCounts.indexOf(peak) : null;
  const shown = hovered ?? busiest;

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={ariaLabel} className="mx-auto block h-auto w-full max-w-[280px]" onMouseLeave={() => setHovered(null)}>
      <circle cx={CENTER} cy={CENTER} r={INNER - 6} className="fill-none stroke-outline-variant" />
      {HOUR_MARKS.map((hour) => {
        const [x, y] = point(hour, LABEL);
        return (
          <text key={hour} x={x} y={y} textAnchor="middle" dominantBaseline="central" className="fill-on-surface-variant text-[10px] tabular-nums">
            {hour}
          </text>
        );
      })}
      {hourCounts.map((count, hour) => {
        const [x1, y1] = point(hour, INNER);
        const [x2, y2] = point(hour, INNER + (peak > 0 ? (count / peak) * (OUTER - INNER) : 0));
        const [hitX, hitY] = point(hour, OUTER);
        return (
          <g key={hour} onMouseEnter={() => setHovered(hour)}>
            {count > 0 && (
              <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={7} strokeLinecap="round" className={hour === shown ? "stroke-primary" : "stroke-primary/40"} />
            )}
            <line x1={x1} y1={y1} x2={hitX} y2={hitY} strokeWidth={13} stroke="transparent" />
          </g>
        );
      })}
      {shown !== null && (
        <>
          <text x={CENTER} y={CENTER - 7} textAnchor="middle" dominantBaseline="central" className="fill-on-surface text-[15px] font-semibold tabular-nums">
            {hourLabel(shown)}
          </text>
          <text x={CENTER} y={CENTER + 11} textAnchor="middle" dominantBaseline="central" className="fill-on-surface-variant text-[11px] tabular-nums">
            {hourCounts[shown]}
          </text>
        </>
      )}
    </svg>
  );
}
