import { SkipForward } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import type { SponsorBlockSegment } from "../../lib/api/foss";
import { isPointSegment } from "../../lib/sponsorBlockPolicy";
import { sponsorBlockCategoryLabel } from "../../lib/sponsorBlockCategories";

interface SponsorBlockSkipButtonProps {
  segment: SponsorBlockSegment;
  compact: boolean;
  onClick: () => void;
}

/** Skip for a segment, or Jump for a highlight, while the action offers one. */
export function SponsorBlockSkipButton({ segment, compact, onClick }: SponsorBlockSkipButtonProps) {
  const label = isPointSegment(segment)
    ? getString("sponsorblock_jump_to_highlight")
    : getString("sponsorblock_skip_segment", sponsorBlockCategoryLabel(segment.category));
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`absolute z-40 flex items-center gap-1.5 rounded-full border border-chrome-toast-border bg-chrome-toast/95 font-semibold text-chrome-neutral-100 shadow-2xl transition-colors duration-200 ease-out hover:bg-chrome-popover ${
        compact ? "right-2 top-2 px-2.5 py-1 text-xs" : "bottom-20 right-3 px-4 py-2 text-sm sm:right-5"
      }`}
    >
      <span className="max-w-64 truncate">{label}</span>
      <SkipForward size={compact ? 14 : 16} fill="currentColor" />
    </button>
  );
}
