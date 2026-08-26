import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getString } from '../../lib/i18n/index';

const NAV_BUTTON =
  'absolute top-1/2 z-20 grid h-10 w-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-chrome-neutral-800 bg-surface-container-high text-chrome-neutral-300 opacity-0 transition-colors duration-200 ease-out hover:bg-surface-container-highest hover:text-chrome-neutral-100 group-hover/shelfnav:opacity-100';

export interface ShelfScrollerProps {
  children: ReactNode;
  /** Classes for the scrolling element itself — gap, padding, snap, grid flow. */
  className?: string;
}

/**
 * Horizontal shelf with the scroll-position-aware arrows, so every shelf in the
 * app navigates the same way instead of each one re-deriving the limits.
 */
export function ShelfScroller({ children, className = '' }: ShelfScrollerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const measure = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const { scrollLeft, scrollWidth, clientWidth } = element;
    setCanScrollLeft(scrollLeft > 2);
    // 2px of slack so sub-pixel rounding cannot strand the right-hand arrow.
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 2);
  }, []);

  /*
    Every trigger below reads scroll geometry, which forces layout. Coalescing
    them into one read per frame matters most for the scroll listener — it fired
    per event, unthrottled — and for the post-render re-measure, which used to be
    a `useLayoutEffect` with no dependency list and so forced a *synchronous*
    layout before paint on every render of any parent.
  */
  const frameRef = useRef<number | null>(null);
  const scheduleMeasure = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      measure();
    });
  }, [measure]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  // No dependency list: re-measuring after every render is what keeps the arrows
  // right when items are added or removed. The arrows are opacity-0 until the
  // shelf is hovered, so resolving them a frame after paint is not visible.
  useEffect(scheduleMeasure);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    element.addEventListener('scroll', scheduleMeasure, { passive: true });
    window.addEventListener('resize', scheduleMeasure);
    // Thumbnails land after mount and change scrollWidth without a re-render.
    const settle = window.setTimeout(scheduleMeasure, 200);

    return () => {
      element.removeEventListener('scroll', scheduleMeasure);
      window.removeEventListener('resize', scheduleMeasure);
      window.clearTimeout(settle);
    };
  }, [scheduleMeasure]);

  const scrollByPage = (direction: -1 | 1) => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({
      left: element.scrollLeft + direction * element.clientWidth * 0.75,
      behavior: 'smooth',
    });
  };

  return (
    <div className="group/shelfnav relative w-full overflow-visible">
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scrollByPage(-1)}
          aria-label={getString('shelf_scroll_left')}
          className={`${NAV_BUTTON} left-0 -ml-2 sm:-ml-4`}
        >
          <ChevronLeft size={20} strokeWidth={2.5} />
        </button>
      )}

      <div ref={scrollRef} className={`overflow-x-auto scroll-smooth scrollbar-none ${className}`}>
        {children}
      </div>

      {canScrollRight && (
        <button
          type="button"
          onClick={() => scrollByPage(1)}
          aria-label={getString('shelf_scroll_right')}
          className={`${NAV_BUTTON} right-0 -mr-2 sm:-mr-4`}
        >
          <ChevronRight size={20} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
