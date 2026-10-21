import { Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { HomeFeedButton } from "./HomeFeedButton";

interface HomeFeedFooterProps {
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onRetry: () => void;
}

/** The end of Home: loading the next page, a retry after a failure, or caught up. */
export function HomeFeedFooter({ hasMore, loadingMore, loadMoreFailed, refreshing, onRefresh, onRetry }: HomeFeedFooterProps) {
  if (loadMoreFailed) {
    return (
      <div className="flex flex-col items-center gap-3 pb-20 text-center">
        <p className="text-sm text-chrome-zinc-300">{getString("home_load_more_failed")}</p>
        <p className="text-xs text-chrome-zinc-500">{getString("home_load_more_failed_body")}</p>
        <HomeFeedButton onClick={onRetry}>
          <RotateCcw size={16} />
          {getString("retry")}
        </HomeFeedButton>
      </div>
    );
  }
  if (!hasMore) {
    return (
      <div className="flex flex-col items-center gap-3 pb-20">
        <p className="text-sm text-chrome-zinc-400">{getString("home_feed_end_title")}</p>
        <HomeFeedButton onClick={onRefresh} disabled={refreshing}>
          <RefreshCw size={16} className={refreshing ? "animate-spin" : undefined} />
          {getString("refresh")}
        </HomeFeedButton>
      </div>
    );
  }
  return (
    <div className="flex h-16 items-center justify-center gap-2 pb-20 text-sm text-chrome-zinc-400">
      {loadingMore ? (
        <>
          <Loader2 size={16} className="animate-spin text-chrome-red-400" />
          {getString("home_feed_loading_more")}
        </>
      ) : (
        <span className="text-xs text-chrome-zinc-500">{getString("home_feed_autoload_hint")}</span>
      )}
    </div>
  );
}
