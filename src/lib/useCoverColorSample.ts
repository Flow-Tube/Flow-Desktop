import { useImageProxyStore } from "../store/useImageProxyStore";
import { proxiedImage } from "./imageProxy";
import { useProxiedImageUrl } from "./useProxiedImageUrl";
import { thumbnailColorSample } from "./thumbnailTiers";
import { thumbnailVideoId, upgradeMusicImageUrl } from "./thumbnails";

// Enough pixels to find a cover's colours; a canvas reads it in well under a millisecond.
const SAMPLE_PX = 128;

/**
 * A small copy of a cover to read its colour from: mqdefault for a video thumbnail, a 128 px crop
 * of Google-hosted art, any other image as it is.
 */
export function coverColorSample(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  const videoId = thumbnailVideoId(trimmed);
  if (videoId) return thumbnailColorSample(videoId);
  return upgradeMusicImageUrl(trimmed, SAMPLE_PX) ?? null;
}

/**
 * `coverColorSample`, loaded the way the cover itself is: a video thumbnail straight from i.ytimg
 * (or the image route where there is one), any other art through the local proxy like the artwork.
 * Google's image servers answered the webview's own requests for avatars with 429 in testing.
 */
export function useCoverColorSample(url: string | null | undefined): string | null {
  const proxyBase = useImageProxyStore((state) => state.base);
  const sample = coverColorSample(url);
  const isThumbnail = Boolean(thumbnailVideoId(url));
  const proxied = useProxiedImageUrl(isThumbnail ? null : sample);
  if (!sample) return null;
  return isThumbnail ? proxiedImage(sample, proxyBase) : (proxied ?? null);
}
