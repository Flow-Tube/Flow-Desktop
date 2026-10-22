import { BadgeCheck } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import type { VideoSummary } from "../../types/video";

/** A channel name with the verified tick YouTube shows next to it. */
export function ChannelLabel({ name, verified }: { name: string; verified?: boolean }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      <span className="truncate">{name}</span>
      {verified && (
        <BadgeCheck
          size={13}
          className="shrink-0 text-chrome-neutral-400"
          aria-label={getString("card_verified_channel")}
        />
      )}
    </span>
  );
}

/** The thumbnail corner badge of a premiere or scheduled stream. */
export function UpcomingBadge({ className }: { className?: string }) {
  return (
    <div
      className={`z-10 rounded bg-chrome-black/80 px-1 py-px text-[11px] font-semibold uppercase leading-tight tracking-wide text-chrome-white ${className ?? ""}`}
    >
      {getString("card_upcoming")}
    </div>
  );
}

/** The card's own badges: members-only first, then YouTube's labels ("4K", "CC", "New"). */
export function CardPills({ video }: { video: VideoSummary }) {
  const labels = [
    ...(video.isMembersOnly ? [getString("card_members_only")] : []),
    ...(video.badges ?? []),
  ];
  if (labels.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {labels.map((label) => (
        <span
          key={label}
          className="rounded-full border border-chrome-neutral-800 px-1.5 py-px text-[11px] font-medium leading-tight text-chrome-neutral-400"
        >
          {label}
        </span>
      ))}
    </div>
  );
}
