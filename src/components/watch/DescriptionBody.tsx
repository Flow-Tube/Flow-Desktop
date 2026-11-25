import { useMemo } from "react";

import { descriptionBlocks } from "../../lib/descriptionBlocks";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { useRichTargetHandler } from "../../lib/useRichTargetHandler";
import { youtubeHqDefaultUrl } from "../../lib/thumbnails";
import type { RichText } from "../../types/video";
import { RichValue } from "./LinkedText";

function VideoLinkCard({ videoId, startSeconds, title }: { videoId: string; startSeconds: number | null; title: string }) {
  const openTarget = useRichTargetHandler();
  const thumbnail = useProxiedImageUrl(youtubeHqDefaultUrl(videoId));
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        openTarget({ kind: "video", videoId, startSeconds });
      }}
      className="flex w-full min-w-0 items-center gap-3 rounded-xl bg-[var(--desc-raised)] p-3 text-start transition-opacity duration-200 ease-out hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-surface-container-highest">
        {thumbnail && <img src={thumbnail} alt="" className="h-full w-full object-cover" />}
      </span>
      <span className="min-w-0">
        <span dir="auto" className="block truncate text-sm font-medium text-chrome-neutral-100">{title}</span>
        <span className="block text-xs text-chrome-neutral-400">YouTube</span>
      </span>
    </button>
  );
}

/**
 * The description's text with each video link that ends its line lifted into a card, as Flow for
 * Android shows it. Collapsed, only the first stretch of text shows, cut at three lines.
 */
export function DescriptionBody({ value, videoId, expanded }: { value: RichText; videoId: string; expanded: boolean }) {
  const blocks = useMemo(() => descriptionBlocks(value, videoId), [value, videoId]);
  if (!expanded) {
    const first = blocks.find((block) => block.kind === "text");
    return first?.kind === "text" ? (
      <div className="line-clamp-3 select-text text-chrome-neutral-200">
        <RichValue value={first.text} />
      </div>
    ) : null;
  }
  return (
    <div className="flex select-text flex-col gap-3 text-chrome-neutral-200">
      {blocks.map((block, index) =>
        block.kind === "text" ? (
          <RichValue key={index} value={block.text} />
        ) : (
          <VideoLinkCard key={index} videoId={block.videoId} startSeconds={block.startSeconds} title={block.title} />
        ),
      )}
    </div>
  );
}
