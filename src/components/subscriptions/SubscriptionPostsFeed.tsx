import { Loader2, MessageSquareText, RotateCcw } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import { useInfiniteScroll } from "../../lib/useInfiniteScroll";
import { useSubscriptionPosts } from "../../lib/useSubscriptionPosts";
import type { SubscribedChannel } from "../../store/useSubscriptionStore";
import type { VideoSummary } from "../../types/video";
import { ChannelPostsFeed } from "../channel/ChannelGrids";
import { Button } from "../ui/Button";

interface SubscriptionPostsFeedProps {
  /** The followed channels in view: every one, or the selected group's. */
  channels: SubscribedChannel[];
  /** The subscription feed, which puts the most active channels first. */
  feed: VideoSummary[];
}

/** Recent posts from followed channels, most active channels first, read eight channels at a time. */
export function SubscriptionPostsFeed({ channels, feed }: SubscriptionPostsFeedProps) {
  const posts = useSubscriptionPosts({ channels, feed, enabled: true });
  const sentinelRef = useInfiniteScroll({
    hasNextPage: posts.hasMore && !posts.error,
    isLoading: posts.loading || posts.loadingMore,
    onLoadMore: posts.loadMore,
  });
  const failed = (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-6 text-center text-sm text-chrome-neutral-300">
      {getString("subscription_posts_load_failed")}
      <Button variant="secondary" size="sm" onClick={posts.retry}>
        <RotateCcw size={15} />
        {getString("retry")}
      </Button>
    </div>
  );

  if (posts.items.length === 0) {
    if (posts.error) return failed;
    if (posts.empty) {
      return (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-chrome-neutral-800 bg-surface-container-low p-10 text-center">
          <MessageSquareText className="mb-3 text-chrome-neutral-600" size={36} />
          <h3 className="text-base font-medium text-chrome-neutral-200">{getString("subscription_posts_empty")}</h3>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-[var(--color-primary)]" size={28} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ChannelPostsFeed posts={posts.items.map((item) => item.post)} />
      {posts.error ? failed : null}
      {posts.loadingMore ? (
        <div className="flex justify-center py-4">
          <Loader2 className="animate-spin text-[var(--color-primary)]" size={22} />
        </div>
      ) : null}
      <div ref={sentinelRef} aria-hidden="true" />
    </div>
  );
}
