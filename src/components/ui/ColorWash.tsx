import type { CSSProperties } from 'react';
import { IS_LINUX_RUNTIME } from '../../lib/platform';
import type { Rgb } from '../../lib/useDominantColor';

/**
 * Hosts must own a stacking context, otherwise the wash paints over the card's
 * own content instead of behind it.
 */
export const COLOR_WASH_HOST = 'relative isolate';

const NEUTRAL_WASH = 'color-mix(in srgb, var(--color-chrome-zinc-800) 50%, transparent)';

/*
  Collapsed narrower on X than on Y, so the wash reads as spreading out towards
  the sides. Rows collapse far less: their travel is the same fraction of a much
  wider box, and the overshoot below scales with it.
*/
const COLLAPSED_TRANSFORM: Record<ColorWashSpread, string> = {
  card: 'scale(0.68, 0.86)',
  row: 'scale(0.9, 0.86)',
};
const EXPANDED_TRANSFORM = 'scale(1, 1)';

/*
  The entry curve overshoots by 3.8% of the travelled distance, so the wash
  settles into its host's edge instead of stopping dead against it. That peak
  stays within the bleed the grid and the shelves reserve around every card.
*/
const EXPAND = 'transform 420ms cubic-bezier(0.34, 1.34, 0.5, 1), opacity 220ms cubic-bezier(0.33, 1, 0.68, 1)';
const COLLAPSE = 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1), opacity 180ms ease-out';
// WebKitGTK composites on the CPU, where scaling a card-sized layer under a
// sweeping cursor costs what the thumbnail zoom already costs us on Linux.
const LINUX_FADE = 'opacity 200ms ease-out';

export type ColorWashSpread = 'card' | 'row';

export interface ColorWashProps {
  /** Drives both the fade and the expansion. */
  active: boolean;
  /** Extracted artwork colour; falls back to a neutral tint when unresolved. */
  color?: Rgb | null;
  /** Must mirror the host's corner radius. */
  radius?: string;
  alpha?: number;
  /** How far the wash collapses at rest — `row` for wide, short hosts. */
  spread?: ColorWashSpread;
  /**
   * Pixels the wash extends past the host on every side, for a halo around a
   * card that owns its own width. Padding plus a negative margin cannot do this
   * on a host with an explicit width: a fixed width simply shrinks by the
   * padding, and `w-full` over-constrains the box so the right margin is
   * dropped and the card slides sideways.
   */
  bleed?: number;
}

/** Artwork-tinted hover layer that expands from the centre of its host. */
export function ColorWash({
  active,
  color,
  radius = 'rounded-xl',
  alpha = 0.22,
  spread = 'card',
  bleed = 0,
}: ColorWashProps) {
  const style: CSSProperties = {
    inset: bleed ? `-${bleed}px` : 0,
    zIndex: -1,
    background: color ? `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})` : NEUTRAL_WASH,
    opacity: active ? 1 : 0,
    transform: IS_LINUX_RUNTIME || active ? EXPANDED_TRANSFORM : COLLAPSED_TRANSFORM[spread],
    transition: IS_LINUX_RUNTIME ? LINUX_FADE : active ? EXPAND : COLLAPSE,
  };

  return <span aria-hidden className={`color-wash pointer-events-none absolute ${radius}`} style={style} />;
}
