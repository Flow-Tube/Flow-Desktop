import { originalImageUrl } from "./imageProxy";

export type ThumbnailQuality = "standard" | "large";

const YOUTUBE_VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;
const YOUTUBE_THUMBNAIL_RE = /(?:https?:)?\/\/(?:i\.ytimg\.com|img\.youtube\.com)\/(?:vi|vi_webp)\/([a-zA-Z0-9_-]{11})\/[^/?#]+/i;
const YOUTUBE_THUMBNAIL_HOST_RE = /(?:^|\.)ytimg\.com$|(?:^|\.)youtube\.com$/i;
const GOOGLE_IMAGE_HOST_RE = /(?:^|\.)googleusercontent\.com$|(?:^|\.)ggpht\.com$/i;
const GOOGLE_CDN_SIZE_RE = /[=/-](?:w|h|s)\d+(?:-[whs]\d+)*/i;
const GOOGLE_CDN_PARAM_START_RE = /=(?:w|h|s)\d+/i;

export function isYoutubeVideoId(id?: string | null): id is string {
  return Boolean(id && YOUTUBE_VIDEO_ID.test(id));
}

export function youtubeThumbnailUrl(
  videoId: string,
  quality: ThumbnailQuality = "standard",
): string {
  const file = quality === "large" ? "maxresdefault" : "hq720";
  return `https://i.ytimg.com/vi/${videoId}/${file}.jpg`;
}

export function upgradeThumbnailUrl(
  url: string,
  quality: ThumbnailQuality = "standard",
): string {
  let upgraded = url.trim();
  if (upgraded.startsWith("//")) {
    upgraded = `https:${upgraded}`;
  }

  const targetFile = quality === "large" ? "maxresdefault" : "hq720";

  upgraded = upgraded.replace(
    /\/(vi(?:_webp)?)\/([a-zA-Z0-9_-]{11})\/(default|mqdefault|sddefault|hqdefault|hq720|maxresdefault)(?:\.\w+)?/i,
    `/vi/$2/${targetFile}.jpg`,
  );

  upgraded = upgraded.replace(
    /=w(\d+)-h(\d+)/,
    quality === "large" ? "=w1280-h720" : "=w640-h360",
  );

  return upgraded;
}

/**
 * Exists for every video, unlike `hq720` and `maxresdefault`. It is 480×360 with
 * the 16:9 frame letterboxed inside, so `object-cover` crops it to 480×270, at
 * about a fifth of the decoded memory of a 1280×720 `hq720`.
 */
function youtubeHqDefaultUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

const HQDEFAULT_WIDTH = 480;

function devicePixelRatio(): number {
  return typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
}

/** Whether a thumbnail drawn this many CSS px wide would upscale `hqdefault`. */
export function thumbnailNeedsHighRes(cssWidth: number): boolean {
  return cssWidth * devicePixelRatio() > HQDEFAULT_WIDTH;
}

/**
 * Every source from the requested quality down to `hqdefault`, so a missing
 * `maxresdefault` lands on `hq720` before the much smaller `hqdefault`.
 */
export function buildThumbnailSources(
  videoId?: string | null,
  fallbackUrl?: string | null,
  quality: ThumbnailQuality = "standard",
): string[] {
  if (isYoutubeVideoId(videoId)) {
    return [
      ...new Set([
        youtubeThumbnailUrl(videoId, quality),
        youtubeThumbnailUrl(videoId, "standard"),
        youtubeHqDefaultUrl(videoId),
      ]),
    ];
  }

  if (!fallbackUrl?.trim()) return [];
  return [
    ...new Set([
      upgradeThumbnailUrl(fallbackUrl, quality),
      upgradeThumbnailUrl(fallbackUrl, "standard"),
    ]),
  ];
}

/**
 * `highRes` says whether the card is drawn wider than `hqdefault`. Callers that
 * do not measure their cards leave it to the screen: a 1× screen starts on
 * `hqdefault`, since cards outside the feed grid stay well under 480 px.
 */
export function resolveYoutubeThumbnailCandidates(
  videoId?: string | null,
  fallbackUrl?: string | null,
  highRes = devicePixelRatio() > 1,
): string[] {
  const raw = fallbackUrl?.trim();
  const resolvedId = isYoutubeVideoId(videoId)
    ? videoId
    : raw?.match(YOUTUBE_THUMBNAIL_RE)?.[1];

  const candidates: string[] = [];
  if (resolvedId) {
    if (highRes) candidates.push(youtubeThumbnailUrl(resolvedId, "standard"));
    candidates.push(youtubeHqDefaultUrl(resolvedId));
  }
  if (raw) {
    candidates.push(upgradeThumbnailUrl(raw, "standard"), raw);
  }
  return [...new Set(candidates.filter(Boolean))];
}

export function isUnavailableYoutubeThumbnail(img: HTMLImageElement): boolean {
  try {
    const url = new URL(originalImageUrl(img.currentSrc || img.src));
    if (!YOUTUBE_THUMBNAIL_HOST_RE.test(url.hostname)) return false;
  } catch {
    return false;
  }

  const width = img.naturalWidth;
  const height = img.naturalHeight;

  return width > 0 && height > 0 && width <= 160 && height <= 120;
}

function isGoogleImageUrl(url: string): boolean {
  try {
    return GOOGLE_IMAGE_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function isYt3ImageUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().startsWith("yt3.");
  } catch {
    return false;
  }
}

function withGoogleEqualsParam(url: string, param: string): string | null {
  const paramStart = url.search(GOOGLE_CDN_PARAM_START_RE);
  if (paramStart >= 0 && url[paramStart] === "=") {
    return `${url.slice(0, paramStart)}=${param}`;
  }
  return null;
}

export function upgradeMusicImageUrl(url: string | null | undefined, size = 1080): string | undefined {
  if (!url?.trim()) return undefined;
  let upgraded = url.trim();
  if (upgraded.startsWith("//")) upgraded = `https:${upgraded}`;

  if (YOUTUBE_THUMBNAIL_RE.test(upgraded)) {
    return upgradeThumbnailUrl(upgraded, "standard");
  }

  if (isGoogleImageUrl(upgraded)) {
    if (isYt3ImageUrl(upgraded)) {
      return withGoogleEqualsParam(upgraded, `s${Math.min(size, 512)}`)
        ?? (GOOGLE_CDN_SIZE_RE.test(upgraded) ? upgraded.replace(GOOGLE_CDN_SIZE_RE, (match) => {
          const prefix = match[0] === "=" || match[0] === "/" || match[0] === "-" ? match[0] : "=";
          return `${prefix}s${Math.min(size, 512)}`;
        }) : `${upgraded}=s${Math.min(size, 512)}`);
    }

    const equalsParamUrl = withGoogleEqualsParam(upgraded, `w${size}-h${size}-p-l90-rj`);
    if (equalsParamUrl) return equalsParamUrl;

    if (GOOGLE_CDN_SIZE_RE.test(upgraded)) {
      return upgraded.replace(GOOGLE_CDN_SIZE_RE, (match) => {
        const prefix = match[0] === "=" || match[0] === "/" || match[0] === "-" ? match[0] : "=";
        return `${prefix}w${size}-h${size}`;
      });
    }

    const paramStart = upgraded.search(GOOGLE_CDN_PARAM_START_RE);
    const base = paramStart >= 0 ? upgraded.slice(0, paramStart) : upgraded;
    return `${base}=w${size}-h${size}-p-l90-rj`;
  }

  return upgraded;
}

export function upgradeLargeGoogleImageUrl(url: string | null | undefined, size = 2048): string | undefined {
  if (!url?.trim()) return undefined;
  let upgraded = url.trim();
  if (upgraded.startsWith("//")) upgraded = `https:${upgraded}`;

  if (isGoogleImageUrl(upgraded)) {
    const equalsParamUrl = withGoogleEqualsParam(upgraded, `s${size}`);
    if (equalsParamUrl) return equalsParamUrl;

    if (GOOGLE_CDN_SIZE_RE.test(upgraded)) {
      return upgraded.replace(GOOGLE_CDN_SIZE_RE, (match) => {
        const prefix = match[0] === "=" || match[0] === "/" || match[0] === "-" ? match[0] : "=";
        return `${prefix}s${size}`;
      });
    }

    const paramStart = upgraded.search(GOOGLE_CDN_PARAM_START_RE);
    const base = paramStart >= 0 ? upgraded.slice(0, paramStart) : upgraded;
    return `${base}=s${size}`;
  }

  return upgraded;
}

export function upgradeChannelBannerUrl(url: string | null | undefined): string | undefined {
  if (!url?.trim()) return undefined;
  let upgraded = url.trim();
  if (upgraded.startsWith("//")) upgraded = `https:${upgraded}`;

  if (isGoogleImageUrl(upgraded)) {
    const equalsParamStart = upgraded.search(GOOGLE_CDN_PARAM_START_RE);
    if (equalsParamStart >= 0) {
      return `${upgraded.slice(0, equalsParamStart)}${upgraded.slice(equalsParamStart).replace(/=(?:w|h|s)\d+/, "=w2560")}`;
    }

    if (GOOGLE_CDN_SIZE_RE.test(upgraded)) {
      return upgraded.replace(GOOGLE_CDN_SIZE_RE, (match) => {
        const prefix = match[0] === "=" || match[0] === "/" || match[0] === "-" ? match[0] : "=";
        return `${prefix}w2560`;
      });
    }

    return `${upgraded}=w2560`;
  }

  return upgraded;
}

export function upgradeCommunityPostImageUrl(url: string | null | undefined): string | undefined {
  return upgradeLargeGoogleImageUrl(url, 2048);
}

export function upgradeAvatarUrl(url: string | null | undefined, size = 512): string | undefined {
  if (!url?.trim()) return undefined;
  let upgraded = url.trim();
  if (upgraded.startsWith("//")) upgraded = `https:${upgraded}`;

  if (isGoogleImageUrl(upgraded)) {
    const equalsParamUrl = withGoogleEqualsParam(upgraded, `s${size}`);
    if (equalsParamUrl) return equalsParamUrl;

    if (GOOGLE_CDN_SIZE_RE.test(upgraded)) {
      return upgraded.replace(GOOGLE_CDN_SIZE_RE, (match) => {
        const prefix = match[0] === "=" || match[0] === "/" || match[0] === "-" ? match[0] : "=";
        return `${prefix}s${size}`;
      });
    }

    const paramStart = upgraded.search(GOOGLE_CDN_PARAM_START_RE);
    const base = paramStart >= 0 ? upgraded.slice(0, paramStart) : upgraded;
    return `${base}=s${size}`;
  }

  return upgraded;
}
