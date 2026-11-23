/**
 * The i.ytimg sizes a card can draw, smallest first, with the usable 16:9 width of each.
 * hqdefault and sddefault are 4:3 files with bars, which a cropped 16:9 card never shows.
 */
export const THUMBNAIL_TIERS = [
  { name: "mqdefault", width: 320 },
  { name: "hqdefault", width: 480 },
  { name: "sddefault", width: 640 },
  { name: "hq720", width: 1280 },
] as const;

export type ThumbnailTier = (typeof THUMBNAIL_TIERS)[number];

const [MQ, HQ, , HQ720] = THUMBNAIL_TIERS;
const MQ_HEIGHT = 180;

// A tier slightly narrower than the card is upscaled by too little to see, and saves a whole step.
const MIN_COVERAGE = 0.9;

function screenPixelRatio(): number {
  return typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
}

/**
 * The smallest tier at least 90% as wide as a card drawn `cssWidth` CSS px wide on this screen.
 * An unknown width starts a HiDPI screen on hq720 and a 1× screen on hqdefault.
 */
export function pickThumbnailTier(cssWidth: number | undefined, pixelRatio = screenPixelRatio()): ThumbnailTier {
  if (!cssWidth || cssWidth <= 0) return pixelRatio > 1 ? HQ720 : HQ;
  const needed = cssWidth * pixelRatio * MIN_COVERAGE;
  return THUMBNAIL_TIERS.find((tier) => tier.width >= needed) ?? HQ720;
}

/**
 * The files to try for a video's thumbnail at `tier`, ending on hqdefault, which every video has.
 * Each is asked for as WebP first, smaller for most videos, then as JPEG for uploads with no WebP copy.
 */
export function thumbnailSources(videoId: string, tier: ThumbnailTier): string[] {
  return [...new Set([tier.name, HQ.name])].flatMap((name) => [
    `https://i.ytimg.com/vi_webp/${videoId}/${name}.webp`,
    `https://i.ytimg.com/vi/${videoId}/${name}.jpg`,
  ]);
}

/**
 * A small copy of a video's thumbnail to read its colour from. The WebP files carry no CORS
 * header, so a canvas can't read the one the card shows; the JPEG tiers can be read.
 */
export function thumbnailColorSample(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

/**
 * The file for a square crop `sizePx` on a side. hqdefault and sddefault pad the frame with bars a
 * square crop would show, so only mqdefault or hq720 fit.
 */
export function squareCropTier(sizePx: number): ThumbnailTier {
  return MQ_HEIGHT >= sizePx * MIN_COVERAGE ? MQ : HQ720;
}

const IMAGE_SIZE_STEPS = [128, 192, 256, 384, 512, 768, 1024, 1536, 2048];

/**
 * The pixel size to ask Google's image CDN for, for an image drawn `cssPx` wide on this screen.
 * It rounds up to a step, so cards of nearly the same size share one URL and one cache entry.
 */
export function imageSizeStep(cssPx: number, pixelRatio = screenPixelRatio()): number {
  const needed = cssPx * Math.max(1, pixelRatio);
  return IMAGE_SIZE_STEPS.find((step) => step >= needed) ?? IMAGE_SIZE_STEPS[IMAGE_SIZE_STEPS.length - 1]!;
}
