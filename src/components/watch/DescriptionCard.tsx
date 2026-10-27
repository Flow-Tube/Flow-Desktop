import { useState } from "react";
import { formatCount } from "../../lib/utils";
import { getString } from "../../lib/i18n/index";
import { hasTextSelection } from "../../lib/textSelection";
import { LinkedText } from "./LinkedText";
import { DescriptionExtras } from "./DescriptionExtras";
import type { DescriptionCardProps } from "./types";

// A live stream's count is YouTube's own "197 watching now", shown as sent.
const formatViews = (views: string | number | null | undefined, isLive: boolean) => {
  if (isLive && typeof views === "string" && views) return views;
  return getString("watch_view_count", views ? formatCount(views) : "0");
};

export function DescriptionCard({ currentVideo, videoData }: DescriptionCardProps) {
  const [expanded, setExpanded] = useState(false);

  const description = videoData?.description || "";
  const viewCount = videoData?.viewCountText || currentVideo.viewCountText || null;
  const published = videoData?.publishedText || currentVideo.publishedText || "";

  return (
    <div
      onClick={() => {
        if (!hasTextSelection()) setExpanded((value) => !value);
      }}
      className="cursor-pointer rounded-xl bg-surface-container-low p-4 text-sm transition-colors hover:bg-surface-container"
    >
      <div className="flex items-center gap-2 font-medium text-chrome-neutral-200">
        <span>{formatViews(viewCount, Boolean(videoData?.isLive))}</span>
        {published && (
          <span className="text-chrome-neutral-400" title={videoData?.relativePublishedText ?? undefined}>
            {published}
          </span>
        )}
      </div>

      <div className={`mt-2 select-text whitespace-pre-wrap text-chrome-neutral-300 ${expanded ? "" : "line-clamp-3"}`}>
        {description ? (
          <LinkedText text={description} rich={videoData?.descriptionRich} />
        ) : (
          <span className="text-chrome-neutral-500">{getString("watch_no_description")}</span>
        )}
      </div>

      {expanded && videoData?.descriptionExtras && <DescriptionExtras extras={videoData.descriptionExtras} />}

      {description && (
        <span className="mt-2 inline-block font-medium text-chrome-neutral-400">
          {expanded ? getString("watch_show_less") : getString("watch_show_more")}
        </span>
      )}
    </div>
  );
}
