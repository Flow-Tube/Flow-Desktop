import { Loader2 } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { useInfiniteScroll } from "../../lib/useInfiniteScroll";

interface LoadMoreRowProps {
  hasMore: boolean;
  loading: boolean;
  failed: boolean;
  onLoadMore: () => void;
  loadingText: string;
  failedText: string;
}

/** The end of a long list: loads the next page as it scrolls into view, or offers Retry. */
export function LoadMoreRow({ hasMore, loading, failed, onLoadMore, loadingText, failedText }: LoadMoreRowProps) {
  const sentinelRef = useInfiniteScroll({ hasNextPage: hasMore && !failed, isLoading: loading, onLoadMore });
  if (!hasMore) return null;

  return (
    <div ref={sentinelRef} className="flex items-center justify-center gap-3 py-6 text-sm text-chrome-neutral-400">
      {failed ? (
        <>
          <span>{failedText}</span>
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
          <span>{loadingText}</span>
        </>
      )}
    </div>
  );
}
