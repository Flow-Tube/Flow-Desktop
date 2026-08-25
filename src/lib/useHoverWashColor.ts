import { useCallback, useState } from 'react';
import { useDominantColor, type Rgb } from './useDominantColor';

export interface HoverWash {
  isHovered: boolean;
  /** Null until the artwork has been sampled — `ColorWash` shows a neutral tint. */
  color: Rgb | null;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

/**
 * Hover state plus the artwork colour that fills a card's `ColorWash`.
 *
 * Sampling is deferred until the pointer first reaches the card: a feed holds
 * hundreds of these, and decoding every thumbnail up front to tint a hover
 * nobody may trigger is not worth it. Priming is one-way — dropping the source
 * on mouse-leave would flip the colour back to neutral halfway through the
 * fade-out — and repeat hovers land on `useDominantColor`'s per-URL cache.
 *
 * Pass the same URL the card renders so the sample reads a warm cache entry.
 */
export function useHoverWashColor(src: string | null | undefined): HoverWash {
  const [isHovered, setIsHovered] = useState(false);
  const [primed, setPrimed] = useState(false);
  const color = useDominantColor(primed ? src : null);

  const onMouseEnter = useCallback(() => {
    setPrimed(true);
    setIsHovered(true);
  }, []);

  const onMouseLeave = useCallback(() => setIsHovered(false), []);

  return { isHovered, color, onMouseEnter, onMouseLeave };
}
