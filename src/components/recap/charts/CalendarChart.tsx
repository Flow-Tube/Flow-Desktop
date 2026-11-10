import { useState } from "react";

import { APP_LOCALE } from "../../../lib/i18n/index";
import { dayLabel, spentTimeLabel } from "../../../lib/recap/recapFormat";

const CELL = 28;
const GAP = 4;
const HEADER = 18;
const STEP = CELL + GAP;
const WIDTH = 7 * CELL + 6 * GAP;
const MIN_OPACITY = 0.2;

interface CalendarChartProps {
  /** "2026-09". */
  month: string;
  dayMs: Record<string, number>;
  ariaLabel: string;
}

/** The month as a Monday-first grid: the deeper a day's color, the more time it held. */
export function CalendarChart({ month, dayMs, ariaLabel }: CalendarChartProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [year, number] = month.split("-").map(Number);
  const first = new Date(year!, number! - 1, 1);
  const count = new Date(year!, number!, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const rows = Math.ceil((lead + count) / 7);
  const days = Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
  const peak = Math.max(...days.map((day) => dayMs[day] ?? 0), 0);
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    new Date(2026, 5, 1 + index).toLocaleDateString(APP_LOCALE, { weekday: "narrow" }),
  );

  return (
    <div className="flex flex-col gap-1.5">
      <svg viewBox={`0 0 ${WIDTH} ${HEADER + rows * STEP}`} role="img" aria-label={ariaLabel} className="mx-auto block h-auto w-full max-w-[320px]" onMouseLeave={() => setHovered(null)}>
        {weekdays.map((name, index) => (
          <text key={index} x={index * STEP + CELL / 2} y={9} textAnchor="middle" dominantBaseline="central" className="fill-on-surface-variant text-[10px]">
            {name}
          </text>
        ))}
        {days.map((day, index) => {
          const slot = lead + index;
          const x = (slot % 7) * STEP;
          const y = HEADER + Math.floor(slot / 7) * STEP;
          const ms = dayMs[day] ?? 0;
          return (
            <g key={day} onMouseEnter={() => setHovered(day)}>
              <rect x={x} y={y} width={CELL} height={CELL} rx={6} className="fill-surface-container-high" />
              {ms > 0 && (
                <rect
                  x={x}
                  y={y}
                  width={CELL}
                  height={CELL}
                  rx={6}
                  className="fill-primary"
                  fillOpacity={MIN_OPACITY + (1 - MIN_OPACITY) * (ms / peak)}
                />
              )}
            </g>
          );
        })}
      </svg>
      <p className="min-h-5 text-center text-sm tabular-nums text-on-surface-variant">
        {hovered ? `${dayLabel(hovered)} · ${spentTimeLabel(dayMs[hovered] ?? 0)}` : ""}
      </p>
    </div>
  );
}
