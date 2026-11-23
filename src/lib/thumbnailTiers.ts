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

const [, HQ, , HQ720] = THUMBNAIL_TIERS;

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

/** The files to try for a video's thumbnail at `tier`, ending on hqdefault, which every video has. */
export function thumbnailSources(videoId: string, tier: ThumbnailTier): string[] {
  return [...new Set([tier.name, HQ.name])].map((name) => `https://i.ytimg.com/vi/${videoId}/${name}.jpg`);
}
