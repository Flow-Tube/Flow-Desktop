import { Loader2 } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { useInfiniteScroll } from "../../lib/useInfiniteScroll";

interface PlaylistLoadMoreProps {
  hasMore: boolean;
  loading: boolean;
  failed: boolean;
  onLoadMore: () => void;
}

/** The end of a long playlist: loads the next page as it scrolls into view, or offers Retry. */
export function PlaylistLoadMore({ hasMore, loading, failed, onLoadMore }: PlaylistLoadMoreProps) {
  const sentinelRef = useInfiniteScroll({ hasNextPage: hasMore && !failed, isLoading: loading, onLoadMore });
  if (!hasMore) return null;

  return (
    <div ref={sentinelRef} className="flex items-center justify-center gap-3 py-6 text-sm text-chrome-neutral-400">
      {failed ? (
        <>
          <span>{getString("playlist_load_more_failed")}</span>
          <button
            type="button"
            onClick={onLoadMore}
            className="rounded-full border border-chrome-neutral-800 px-4 py-1.5 font-medium text-chrome-neutral-200 transition-colors hover:bg-surface-container"
          >
            {getString("retry")}
          </button>
        </>
      ) : (
        <>
          <Loader2 className="animate-spin" size={18} />
          <span>{getString("playlist_loading_more")}</span>
        </>
      )}
    </div>
  );
}
