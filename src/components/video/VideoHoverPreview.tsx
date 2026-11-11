import { memo, type RefObject } from "react";
import { useHoverPreview } from "../../lib/useHoverPreview";
import { VideoThumbnailPreview } from "./VideoThumbnailPreview";

interface VideoHoverPreviewProps {
  videoId: string;
  durationSeconds?: number | null;
  thumbnailRef: RefObject<HTMLElement | null>;
}

const devicePixelSize = (element: HTMLElement | null) => {
  if (!element) return null;
  const dpr = window.devicePixelRatio || 1;
  return { width: element.offsetWidth * dpr, height: element.offsetHeight * dpr };
};

/**
 * A card's hover preview. Cards mount it only while hovered, so the preview's timers and frame
 * changes re-render this layer alone, never the card or the rest of the feed.
 */
export const VideoHoverPreview = memo(function VideoHoverPreview({ videoId, durationSeconds, thumbnailRef }: VideoHoverPreviewProps) {
  const preview = useHoverPreview({
    videoId,
    isHovered: true,
    durationSeconds,
    measure: () => devicePixelSize(thumbnailRef.current),
  });
  return (
    <VideoThumbnailPreview
      isActive={preview.isPreviewActive}
      frame={preview.currentFrame}
      level={preview.currentLevel}
      progressPercent={preview.progressPercent}
    />
  );
});
