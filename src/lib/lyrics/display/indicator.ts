/** Port of Android's IntervalIndicator: three dots that fill with an instrumental break and breathe. */

export const DOT_SIZE = 10;
export const DOT_GAP = 12;
const BREATH_PERIOD_MS = 1600;
/** The indicator stops this long before the next line starts. */
export const INDICATOR_LEAD_OUT_MS = 650;

export interface DotLook {
  opacity: number;
  scale: number;
}

/** How dot `i` looks `position` ms into a break; `breathMs` is the time the breath has run, or null. */
export function dotLook(i: number, position: number, gapStartMs: number, gapEndMs: number, breathMs: number | null, out: DotLook): DotLook {
  const span = Math.max(1, gapEndMs - gapStartMs);
  const progress = Math.min(1, Math.max(0, (position - gapStartMs) / span));
  const handOff = Math.min(1, Math.max(0, (1 - progress) / 0.12));
  const breath = breathMs === null ? 1 : 1 + 0.08 * Math.sin(((breathMs % BREATH_PERIOD_MS) / BREATH_PERIOD_MS) * 2 * Math.PI);
  const fill = Math.min(1, Math.max(0, progress * 3 - i));
  out.opacity = (0.22 + 0.78 * fill) * handOff;
  out.scale = (0.8 + 0.25 * fill) * breath;
  return out;
}

/** Whether a break's indicator shows: only while following the song, and not in its last moments. */
export const indicatorVisible = (autoScroll: boolean, position: number, gapStartMs: number, gapEndMs: number): boolean =>
  autoScroll && position >= gapStartMs && position <= gapEndMs - INDICATOR_LEAD_OUT_MS;
