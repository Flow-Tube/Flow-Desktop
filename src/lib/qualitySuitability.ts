import { useEffect, useMemo, useState } from "react";
import type { StreamVariant } from "../types/video";

export type QualityTier = "recommended" | "demanding" | "standard";

export interface QualitySuitability {
  tier: QualityTier;
  badgeKey?: "player_quality_recommended" | "player_quality_demanding";
  isDemanding?: boolean;
  isRecommended?: boolean;
}

export interface SuitabilityOptions {
  isSmooth?: boolean;
  screenWidth?: number;
  screenHeight?: number;
  dpr?: number;
  allQualities?: StreamVariant[];
}

const decodingCache = new Map<string, boolean>();

/**
 * Asynchronously probes whether the hardware decoder can decode this stream variant smoothly.
 * Returns true if smooth, false if unsupported/choppy, or null if MediaCapabilities is unavailable.
 */
export async function probeMediaCapabilities(variant: StreamVariant): Promise<boolean | null> {
  if (typeof navigator === "undefined" || !navigator.mediaCapabilities?.decodingInfo) {
    return null;
  }

  const mime = variant.mimeType || 'video/mp4; codecs="avc1.640028"';
  const width = variant.width || 1920;
  const height = variant.height || 1080;
  const fps = variant.fps || 30;
  const bitrate = variant.bitrate || 5_000_000;
  const key = `${mime}:${width}x${height}@${fps}:${bitrate}`;

  if (decodingCache.has(key)) {
    return decodingCache.get(key) ?? null;
  }

  try {
    const result = await navigator.mediaCapabilities.decodingInfo({
      type: "media-source",
      video: {
        contentType: mime,
        width,
        height,
        bitrate,
        framerate: fps,
      },
    });

    const isSmooth = Boolean(result.supported && result.smooth);
    decodingCache.set(key, isSmooth);
    return isSmooth;
  } catch {
    return null;
  }
}

/**
 * Evaluates whether a video stream variant is recommended, demanding/heavy, or standard for the current device.
 */
export function evaluateQualitySuitability(
  variant: StreamVariant,
  options?: SuitabilityOptions,
): QualitySuitability {
  const height = variant.height;
  if (!height || typeof height !== "number") {
    return { tier: "standard" };
  }

  // 1. 8K (4320p) is universally demanding on consumer desktop GPUs and network buffers
  if (height >= 4320) {
    return {
      tier: "demanding",
      badgeKey: "player_quality_demanding",
      isDemanding: true,
    };
  }

  // 2. Hardware probe explicitly reported that decoding is not smooth
  if (options?.isSmooth === false) {
    return {
      tier: "demanding",
      badgeKey: "player_quality_demanding",
      isDemanding: true,
    };
  }

  const dpr = options?.dpr ?? (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  const screenH = options?.screenHeight ?? (typeof window !== "undefined" ? window.screen?.height || 1080 : 1080);
  const effectiveScreenHeight = screenH * dpr;

  // 3. 4K (2160p) on low-resolution displays without verified smooth hardware decoding
  if (height >= 2160) {
    if (effectiveScreenHeight < 1200 && options?.isSmooth !== true) {
      return {
        tier: "demanding",
        badgeKey: "player_quality_demanding",
        isDemanding: true,
      };
    }
  }

  // 4. Determine highest available resolution on this video
  const maxAvailableHeight = options?.allQualities && options.allQualities.length > 0
    ? Math.max(...options.allQualities.map((q) => q.height || 0))
    : 1080;

  // 5. 1080p is the universal recommendation for desktop streaming clarity and stability
  if (height === 1080) {
    return {
      tier: "recommended",
      badgeKey: "player_quality_recommended",
      isRecommended: true,
    };
  }

  // 6. 1440p (QHD) recommended if device screen has native QHD/4K pixels
  if (height === 1440 && effectiveScreenHeight >= 1400) {
    return {
      tier: "recommended",
      badgeKey: "player_quality_recommended",
      isRecommended: true,
    };
  }

  // 7. For videos capped below 1080p (e.g., 720p/480p max), recommend the highest available quality
  if (maxAvailableHeight < 1080 && height === maxAvailableHeight && height >= 360) {
    return {
      tier: "recommended",
      badgeKey: "player_quality_recommended",
      isRecommended: true,
    };
  }

  return { tier: "standard" };
}

/**
 * Hook to evaluate quality suitability for a list of stream variants, with asynchronous hardware probing.
 */
export function useQualitySuitability(qualities: StreamVariant[]): {
  suitabilityMap: Record<string, QualitySuitability>;
  hasDemandingQualities: boolean;
} {
  const [smoothnessMap, setSmoothnessMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;

    // Probe high-res or heavy variants (>= 1440p) to test hardware decoding smoothness
    const heavyVariants = qualities.filter((q) => (q.height || 0) >= 1440);
    if (heavyVariants.length === 0) return;

    for (const variant of heavyVariants) {
      void probeMediaCapabilities(variant).then((isSmooth) => {
        if (!cancelled && isSmooth !== null) {
          setSmoothnessMap((prev) => (prev[variant.id] === isSmooth ? prev : { ...prev, [variant.id]: isSmooth }));
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [qualities]);

  const screenMetrics = useMemo(() => {
    if (typeof window === "undefined") {
      return { screenWidth: 1920, screenHeight: 1080, dpr: 1 };
    }
    return {
      screenWidth: window.screen?.width || 1920,
      screenHeight: window.screen?.height || 1080,
      dpr: window.devicePixelRatio || 1,
    };
  }, []);

  const suitabilityMap = useMemo(() => {
    const map: Record<string, QualitySuitability> = {};
    for (const quality of qualities) {
      map[quality.id] = evaluateQualitySuitability(quality, {
        isSmooth: smoothnessMap[quality.id],
        screenHeight: screenMetrics.screenHeight,
        screenWidth: screenMetrics.screenWidth,
        dpr: screenMetrics.dpr,
        allQualities: qualities,
      });
    }
    return map;
  }, [qualities, smoothnessMap, screenMetrics]);

  const hasDemandingQualities = useMemo(() => {
    return Object.values(suitabilityMap).some((s) => s.isDemanding);
  }, [suitabilityMap]);

  return { suitabilityMap, hasDemandingQualities };
}
