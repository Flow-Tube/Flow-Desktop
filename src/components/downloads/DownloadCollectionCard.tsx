import { Check, Disc3, Download, ListVideo, Loader2, Trash2 } from "lucide-react";

import type { DownloadCollectionRecord } from "../../lib/api/downloads";
import type { CollectionDownloadState } from "../../lib/useCollectionDownloads";
import { getString } from "../../lib/i18n/index";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";

interface DownloadCollectionCardProps {
  collection: DownloadCollectionRecord;
  progress: CollectionDownloadState;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onOpen?: () => void;
  onDelete?: () => void;
}

export function DownloadCollectionCard({
  collection,
  progress,
  selectable = false,
  selected = false,
  onToggleSelect,
  onOpen,
  onDelete,
}: DownloadCollectionCardProps) {
  const thumbnail = useProxiedImageUrl(collection.coverUrl ?? collection.thumbnailUrl);
  const isAlbum = collection.kind === "album";
  const { total, completed, active, isComplete } = progress;
  const percent = total > 0 ? Math.min(100, (completed / total) * 100) : 0;
  const PlaceholderIcon = isAlbum ? Disc3 : ListVideo;

  const activate = () => {
    if (selectable) onToggleSelect?.();
    else onOpen?.();
  };

  return (
    <div className="group flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        onClick={activate}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") activate();
        }}
        className={`relative w-full cursor-pointer overflow-hidden border bg-surface-container ${
          isAlbum ? "aspect-square rounded-xl" : "aspect-video rounded-xl"
        } ${selected ? "border-[var(--color-primary)]" : "border-transparent"}`}
      >
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={collection.title}
            loading="lazy"
            className={`h-full w-full object-cover transition-transform duration-300 ${
              isComplete ? "group-hover:scale-[1.03]" : "scale-100 opacity-60"
            }`}
          />
        ) : (
          <div className="grid h-full w-full place-items-center bg-surface-container-high text-chrome-neutral-600">
            <PlaceholderIcon className="h-10 w-10" />
          </div>
        )}

        {!isComplete ? (
          <div className="absolute inset-0 flex flex-col justify-end bg-chrome-black/40 p-3">
            <div className="flex items-center gap-2">
              <span className="text-chrome-neutral-100">
                {active ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-chrome-neutral-100">
                {getString("downloads_collection_progress", completed, total)}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-chrome-white/25">
              <div
                className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-200"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1 rounded-full bg-chrome-black/80 px-2 py-0.5 text-[12px] font-medium leading-tight text-chrome-white">
            <Check size={12} className="text-[var(--color-primary)]" />
            {total}
          </div>
        )}

        {!selectable && onDelete ? (
          <button
            type="button"
            aria-label={getString("downloads_remove")}
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            className="absolute right-2 top-2 z-20 grid h-8 w-8 place-items-center rounded-full border border-chrome-white/15 bg-chrome-black/80 text-chrome-white opacity-0 transition-colors duration-200 ease-out hover:bg-chrome-red-950/50 hover:text-chrome-red-300 group-hover:opacity-100"
          >
            <Trash2 size={15} />
          </button>
        ) : null}

        {selectable ? (
          <div
            className={`absolute left-2 top-2 z-20 grid h-6 w-6 place-items-center rounded-full border transition-colors ${
              selected
                ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                : "border-chrome-white/70 bg-chrome-black/40 text-transparent"
            }`}
          >
            <Check size={14} />
          </div>
        ) : null}
      </div>

      <div className="min-w-0">
        <h3
          onClick={activate}
          className="line-clamp-2 cursor-pointer text-sm font-medium leading-snug text-chrome-neutral-100 transition-colors hover:text-chrome-white"
        >
          {collection.title}
        </h3>
        <div className="mt-0.5 truncate text-[13px] text-chrome-neutral-400">
          {collection.author ||
            getString(isAlbum ? "downloads_albums_section" : "downloads_playlists_section")}
        </div>
      </div>
    </div>
  );
}
