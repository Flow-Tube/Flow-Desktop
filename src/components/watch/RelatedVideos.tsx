import { Loader2 } from "lucide-react";
import { VideoCard } from "../video/VideoCard";
import { Button } from "../ui/Button";
import { getString } from "../../lib/i18n/index";
import { relatedItemToVideoSummary } from "../../lib/relatedLane";
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
  if (loading) {
    return <Loader2 className="mx-auto mt-10 animate-spin text-chrome-neutral-500" size={24} />;
  }

  if (items.length === 0) {
    return <p className="mt-6 text-center text-sm text-chrome-neutral-500">{getString("watch_no_related")}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <VideoCard
          key={`${item.itemType}-${item.id}`}
          video={relatedItemToVideoSummary(item)}
          variant="compact"
          onPlay={() => onSelect(item)}
          onAddToQueue={onAddToQueue}
        />
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
