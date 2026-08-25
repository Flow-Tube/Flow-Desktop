import React from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { getString } from "../../lib/i18n/index";

interface LibraryShelfProps {
  /** Section heading, e.g. "History". */
  title: string;
  /** Lucide icon rendered beside the title (and inside the empty state). */
  icon: React.ComponentType<{ className?: string }>;
  /** Route the "View all" pill navigates to, e.g. "/history". */
  viewAllTo: string;
  /** When true, render the MD3 empty state in place of the swiper. */
  isEmpty?: boolean;
  /** Optional override for the empty-state caption. */
  emptyLabel?: string;
  /** Card cells — each must carry its own `w-[px] shrink-0` sizing. */
  children: React.ReactNode;
}

/**
 * The reusable horizontal shelf used across the Library hub. Renders the MD3
 * header row (icon + title + tonal "View all" pill) above either a native
 * swiper row of cards or — when `isEmpty` — a subtle dashed-border empty state.
 * Cards are supplied as children so this wrapper stays presentational and the
 * page owns data + card selection.
 */
export const LibraryShelf: React.FC<LibraryShelfProps> = ({
  title,
  icon: Icon,
  viewAllTo,
  isEmpty = false,
  emptyLabel,
  children,
}) => {
  const navigate = useNavigate();

  return (
    <section className="flex flex-col">
      {/* Shelf Header */}
      <div className="flex justify-between items-end mb-4">
        <h2 className="text-2xl font-bold tracking-tight text-chrome-neutral-100 flex items-center gap-3">
          <Icon className="w-6 h-6 text-chrome-neutral-400" />
          {title}
        </h2>

        <button
          type="button"
          onClick={() => navigate(viewAllTo)}
          className="flex items-center gap-1 rounded-full bg-surface-container-high px-4 py-1.5 text-sm font-medium text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-surface-container-highest"
        >
          {getString("library_view_all")}
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Shelf body — swiper of cards, or the MD3 empty state */}
      {isEmpty ? (
        <div className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-chrome-neutral-800">
          <Icon className="h-6 w-6 text-chrome-neutral-600" />
          <p className="text-sm text-chrome-neutral-500">
            {emptyLabel ?? getString("library_empty_generic")}
          </p>
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto snap-x hide-scrollbar px-3 -mx-3 pt-3 -mt-2 pb-4">
          {children}
        </div>
      )}
    </section>
  );
};

export default LibraryShelf;
