import { memo, type RefObject } from "react";
import { useHoverPreview } from "../../lib/useHoverPreview";
import { useHoverPreviewMode } from "../../lib/hoverPreviewMode";
import { VideoThumbnailPreview } from "./VideoThumbnailPreview";
import { VideoInlinePreview } from "./VideoInlinePreview";

interface VideoHoverPreviewProps {
  videoId: string;
  durationSeconds?: number | null;
  thumbnailRef: RefObject<HTMLElement | null>;
  /** The card has a button of its own in the thumbnail's top end corner. */
  clearTopEnd?: boolean;
}

const devicePixelSize = (element: HTMLElement | null) => {
  if (!element) return null;
  const dpr = window.devicePixelRatio || 1;
  return { width: element.offsetWidth * dpr, height: element.offsetHeight * dpr };
};

function FramesPreview({ videoId, durationSeconds, thumbnailRef }: VideoHoverPreviewProps) {
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
}

/**
 * A card's hover preview, of the kind chosen in Settings. Cards mount it only while hovered, so
 * the preview's timers and frame changes re-render this layer alone, never the card or the feed.
 */
export const VideoHoverPreview = memo(function VideoHoverPreview(props: VideoHoverPreviewProps) {
  const mode = useHoverPreviewMode();
  if (mode === "frames") return <FramesPreview {...props} />;
  if (mode === "video") return <VideoInlinePreview videoId={props.videoId} clearTopEnd={props.clearTopEnd} />;
  return null;
});
