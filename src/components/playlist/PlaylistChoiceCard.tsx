import { ListVideo } from "lucide-react";
import { storedPlaylistToCardSummary, WATCH_LATER_PLAYLIST_ID, type StoredPlaylist } from "../../lib/playlistLibrary";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";

/** A row naming a playlist something can go into. */
export function PlaylistChoiceCard({
  fallbackThumbnailUrl,
  playlist,
  onClick,
}: {
  fallbackThumbnailUrl?: string | null;
  playlist: StoredPlaylist;
  onClick: () => void;
}) {
  const summary = storedPlaylistToCardSummary(playlist);
  const thumbnailUrl = summary.thumbnailUrl
    ?? (playlist.id === WATCH_LATER_PLAYLIST_ID ? fallbackThumbnailUrl : null)
    ?? null;
  const imageSrc = useProxiedImageUrl(thumbnailUrl);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg p-2 text-start transition-colors hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="relative aspect-video w-20 shrink-0 overflow-hidden rounded-md bg-surface-container-high ring-1 ring-chrome-neutral-800/50">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="grid h-full w-full place-items-center text-chrome-neutral-500">
            <ListVideo size={20} />
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span dir="auto" className="line-clamp-1 text-sm font-medium text-chrome-neutral-100">
          {summary.title}
        </span>
        <span className="line-clamp-1 text-xs text-chrome-neutral-500">
          {summary.videoCountText}
        </span>
      </span>
    </button>
  );
}
