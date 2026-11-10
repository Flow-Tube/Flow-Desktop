import type { RankedItem } from "../../lib/api/recap";
import { getString } from "../../lib/i18n/index";
import { rankedItemOpens } from "../../lib/recap/useRecapLinks";
import { useChannelAvatar } from "../../lib/useChannelAvatar";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";

function RowImage({ item, portrait }: { item: RankedItem; portrait: boolean }) {
  // A channel with no stored portrait looks one up; every other row uses what the ledger kept.
  const looked = useChannelAvatar(item.kind === "CHANNEL" && !item.imageUrl ? item.id : null);
  const src = useProxiedImageUrl(item.imageUrl || looked);
  const shape = portrait ? "rounded-full" : "rounded-lg";
  if (!src) {
    return (
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center bg-surface-container-high text-sm font-medium text-on-surface-variant ${shape}`}>
        {item.name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return <img src={src} alt="" loading="lazy" className={`h-10 w-10 shrink-0 object-cover ${shape}`} />;
}

interface RankRowsProps {
  items: RankedItem[];
  value: (item: RankedItem) => string;
  portraits?: boolean;
  images?: boolean;
  onOpen?: (item: RankedItem) => void;
}

export function RankRows({ items, value, portraits = false, images = true, onOpen }: RankRowsProps) {
  return (
    <ol className="flex flex-col gap-0.5">
      {items.map((item, index) => {
        const opens = onOpen && rankedItemOpens(item);
        const content = (
          <>
            <span className="w-4 shrink-0 text-center text-sm font-semibold tabular-nums text-on-surface-variant">{index + 1}</span>
            {images && <RowImage item={item} portrait={portraits} />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-on-surface">{item.name || getString("recap_unnamed_item")}</span>
              {item.detail && <span className="block truncate text-xs text-on-surface-variant">{item.detail}</span>}
            </span>
            <span className="shrink-0 text-sm tabular-nums text-on-surface-variant">{value(item)}</span>
          </>
        );
        return (
          <li key={item.id}>
            {opens ? (
              <button
                type="button"
                onClick={() => onOpen(item)}
                className="flex w-full items-center gap-3 rounded-lg p-1.5 text-start transition-colors duration-200 ease-out hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {content}
              </button>
            ) : (
              <div dir="auto" className="flex items-center gap-3 p-1.5">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
