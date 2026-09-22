import { useMemo } from "react";
import {
  buildThumbnailSources,
  type ThumbnailQuality,
} from "./thumbnails";
import { useImageFallback } from "./useImageFallback";

export function useVideoThumbnail(
  videoId?: string | null,
  fallbackUrl?: string | null,
  quality: ThumbnailQuality = "standard",
) {
  const sources = useMemo(
    () => buildThumbnailSources(videoId, fallbackUrl, quality),
    [videoId, fallbackUrl, quality],
  );

  return useImageFallback([sources.primary, sources.fallback]);
}
