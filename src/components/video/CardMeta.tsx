import { BadgeCheck, Music2 } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { upgradeAvatarUrl } from "../../lib/thumbnails";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import type { Collaborator, VideoSummary } from "../../types/video";

/** A channel name with the verified tick, or the official artist note, YouTube shows next to it. */
export function ChannelLabel({
  name,
  verified,
  artist,
  iconSize = 13,
}: {
  name: string;
  verified?: boolean;
  artist?: boolean;
  iconSize?: number;
}) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      <span className="truncate">{name}</span>
      {artist ? (
        <Music2 size={iconSize} className="shrink-0 text-chrome-neutral-400" aria-label={getString("card_verified_artist")} />
      ) : (
        verified && (
          <BadgeCheck
            size={iconSize}
            className="shrink-0 text-chrome-neutral-400"
            aria-label={getString("card_verified_channel")}
          />
        )
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

/** The first two channels of a collaboration, overlapped in the card's avatar slot. */
export function CollabAvatars({ collaborators }: { collaborators: Collaborator[] }) {
  const first = useProxiedImageUrl(upgradeAvatarUrl(collaborators[0]?.avatarUrl ?? null));
  const second = useProxiedImageUrl(upgradeAvatarUrl(collaborators[1]?.avatarUrl ?? null));
  const avatar = (src: string | null | undefined, name: string | undefined, position: string) => (
    <span
      className={`absolute h-7 w-7 overflow-hidden rounded-full border-2 border-surface bg-chrome-zinc-800 ${position}`}
    >
      {src && <img src={src} alt={name ?? ""} className="h-full w-full object-cover" loading="lazy" />}
    </span>
  );
  return (
    <span className="relative block h-9 w-9">
      {avatar(first, collaborators[0]?.name, "left-0 top-0")}
      {avatar(second, collaborators[1]?.name, "bottom-0 right-0")}
    </span>
  );
}
