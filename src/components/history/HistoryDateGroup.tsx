import { useState } from "react";
import { VideoShelf } from "../shelf/VideoShelf";
import { VideoGrid } from "../video/VideoGrid";
import { Button } from "../ui/Button";
import { getPlural, getString } from "../../lib/i18n/index";
import { MusicHistoryGrid } from "./MusicHistoryGrid";
import type { HistoryDateGroup as HistoryDateGroupData } from "../../lib/useHistory";
import type { VideoSummary } from "../../types/video";
import { joinIsolated } from "../../lib/direction";

interface HistoryDateGroupProps {
  group: HistoryDateGroupData;
  onPlay: (video: VideoSummary) => void;
  onRemoveFromHistory: (videoId: string) => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export function HistoryDateGroup({
  group,
  onPlay,
  onRemoveFromHistory,
  isExpanded: isExpandedProp,
  onToggleExpand,
}: HistoryDateGroupProps) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isControlled = isExpandedProp !== undefined;
  const isExpanded = isControlled ? isExpandedProp : internalExpanded;
  const toggleExpand = () => {
    if (isControlled) onToggleExpand?.();
    else setInternalExpanded((current) => !current);
  };
  const { dateLabel, videos } = group;
  const musicVideos = videos.filter((video) => video.isMusic);
  const plainVideos = videos.filter((video) => !video.isMusic);

  const getHistoryVideoKey = (video: VideoSummary, index: number) => {
    const watchDate = "watchDate" in video ? String(video.watchDate ?? "unknown") : "unknown";
    return `${dateLabel}-${video.id}-${watchDate}-${index}`;
  };

  const countLabel = joinIsolated([
    plainVideos.length > 0 ? getPlural("history_videos_count", plainVideos.length) : null,
    musicVideos.length > 0 ? getPlural("history_songs_count", musicVideos.length) : null,
  ]);

  return (
    <section className="min-w-0">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight text-chrome-neutral-100">
            {dateLabel}
          </h2>
          <p className="mt-1 text-sm text-chrome-neutral-400">{countLabel}</p>
        </div>

        {plainVideos.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={toggleExpand}
            className="shrink-0 text-[var(--color-primary)] hover:text-[var(--color-primary)]"
            aria-expanded={isExpanded}
          >
            {isExpanded ? getString("history_collapse") : getString("history_see_all")}
          </Button>
        )}
      </div>

      {plainVideos.length > 0 && (
        <div className="transition-colors duration-200 ease-out">
          {isExpanded ? (
            <VideoGrid
              videos={plainVideos}
              onPlay={onPlay}
              onRemoveFromHistory={onRemoveFromHistory}
              getVideoKey={getHistoryVideoKey}
              variant="history"
              hideChannelAvatar={true}
            />
          ) : (
            <VideoShelf
              videos={plainVideos}
              onPlay={onPlay}
              onRemoveFromHistory={onRemoveFromHistory}
              getVideoKey={getHistoryVideoKey}
              variant="history"
              hideChannelAvatar={true}
            />
          )}
        </div>
      )}

      {musicVideos.length > 0 && (
        <div className={plainVideos.length > 0 ? "mt-6" : ""}>
          <MusicHistoryGrid videos={musicVideos} onRemoveFromHistory={onRemoveFromHistory} />
        </div>
      )}
    </section>
  );
}
