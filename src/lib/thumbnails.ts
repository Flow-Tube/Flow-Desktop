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

/** Upgrade Innertube / cached URLs; prefer canonical i.ytimg.com when we have a video id. */
export function resolveVideoThumbnailUrl(
  videoId?: string | null,
  fallbackUrl?: string | null,
  quality: ThumbnailQuality = "standard",
): string | undefined {
  if (isYoutubeVideoId(videoId)) {
    return youtubeThumbnailUrl(videoId, quality);
  }

  if (!fallbackUrl?.trim()) return undefined;
  return upgradeThumbnailUrl(fallbackUrl, quality);
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

export function buildThumbnailSources(
  videoId?: string | null,
  fallbackUrl?: string | null,
  quality: ThumbnailQuality = "standard",
) {
  const hqFallback = isYoutubeVideoId(videoId)
    ? youtubeThumbnailUrl(videoId, "standard")
    : fallbackUrl
      ? upgradeThumbnailUrl(fallbackUrl, "standard")
      : undefined;

  const primary = resolveVideoThumbnailUrl(videoId, fallbackUrl, quality) ?? hqFallback;

  return {
    primary,
    fallback: hqFallback ?? primary,
  };
}

export function resolveYoutubeThumbnailCandidates(
  videoId?: string | null,
  fallbackUrl?: string | null,
): string[] {
  const raw = fallbackUrl?.trim();
  const resolvedId = isYoutubeVideoId(videoId)
    ? videoId
    : raw?.match(YOUTUBE_THUMBNAIL_RE)?.[1];

  const candidates: string[] = [];
  if (resolvedId) {
    candidates.push(
      youtubeThumbnailUrl(resolvedId, "standard"),
      `https://i.ytimg.com/vi/${resolvedId}/hqdefault.jpg`,
    );
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
