import { useMemo, useRef } from "react";
import { Loader2 } from "lucide-react";
import { VideoCard } from "../video/VideoCard";
import { Button } from "../ui/Button";
import { getString } from "../../lib/i18n/index";
import { relatedItemToVideoSummary } from "../../lib/relatedLane";
import { noteSeen } from "../../lib/feedImpressions";
import { IMPRESSION_ATTRIBUTE, useFeedImpressions } from "../../lib/useFeedImpressions";
import type { RelatedVideosProps } from "./types";

export function RelatedVideos({
  items,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  onSelect,
  onAddToQueue,
}: RelatedVideosProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const entries = useMemo(
    () => items.map((item) => ({ item, video: relatedItemToVideoSummary(item) })),
    [items],
  );
  const videos = useMemo(() => entries.map((entry) => entry.video), [entries]);
  // Cards seen here count for "Hide videos you've already seen", but teach the ranker nothing.
  useFeedImpressions(listRef, videos, !loading, noteSeen);

  if (loading) {
    return <Loader2 className="mx-auto mt-10 animate-spin text-chrome-neutral-500" size={24} />;
  }

  if (items.length === 0) {
    return <p className="mt-6 text-center text-sm text-chrome-neutral-500">{getString("watch_no_related")}</p>;
  }

  return (
    <div ref={listRef} className="flex flex-col gap-3">
      {entries.map(({ item, video }) => (
        <div
          key={`${item.itemType}-${item.id}`}
          {...(item.itemType === "video" ? { [IMPRESSION_ATTRIBUTE]: video.id } : {})}
        >
          <VideoCard
            video={video}
            variant="compact"
            onPlay={() => onSelect(item)}
            onAddToQueue={onAddToQueue}
          />
        </div>
      ))}
      {hasMore && (
        <Button variant="tonal" onClick={onLoadMore} disabled={loadingMore} className="self-center">
          {loadingMore && <Loader2 className="animate-spin" size={16} />}
          {getString("watch_show_more_related")}
        </Button>
      )}
    </div>
  );
}
