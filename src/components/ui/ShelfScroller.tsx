import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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

  // No dependency list: re-measuring after every render is what keeps the arrows
  // right when items are added or removed.
  useLayoutEffect(measure);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    element.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    // Thumbnails land after mount and change scrollWidth without a re-render.
    const settle = window.setTimeout(measure, 200);

    return () => {
      element.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      window.clearTimeout(settle);
    };
  }, [measure]);

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
