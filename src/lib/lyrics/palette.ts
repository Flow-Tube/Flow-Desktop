import {
  artworkSwatches,
  quantizeSwatches,
  SAMPLE_SIDE,
} from "../color/artworkSwatches";
import type { Rgb } from "../useDominantColor";

export interface CardStyleOption {
  id: string;
  label: string;
  ground: string; // hex color for card background
  ink: string; // hex color for text, divider, logo
  hex: string; // alias to ground for backwards compatibility
  isCover?: boolean;
  isLight: boolean;
}

export type CardPaletteOption = CardStyleOption;

export function rgbToHex({ r, g, b }: Rgb): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!match || !match[1] || !match[2] || !match[3]) return null;
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}

export function isLightColor(colorHex: string): boolean {
  if (colorHex === "cover") return false;
  const rgb = hexToRgb(colorHex);
  if (!rgb) return false;
  // Perceived brightness formula (HSP/ITU-R BT.601)
  const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return brightness > 150;
}

export function getContrastingInk(groundHex: string): string {
  return isLightColor(groundHex) ? "#111111" : "#ffffff";
}

/**
 * Euclidean RGB distance normalized to 0..1 scale.
 * Matches Android PR #1968: sqrt(dr^2 + dg^2 + db^2) < 0.06f
 */
export const SAME_GROUND_DISTANCE = 0.06;

export function colorDistance(hexA: string, hexB: string): number {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return 1;
  const dr = (a.r - b.r) / 255;
  const dg = (a.g - b.g) / 255;
  const db = (a.b - b.b) / 255;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function looksAlike(groundA: string, groundB: string): boolean {
  return colorDistance(groundA, groundB) < SAME_GROUND_DISTANCE;
}

/**
 * Deduplicates styles whose background colors are too similar to be visually distinct.
 * Excludes COLORFUL (isCover) from deduplication, exactly like Android.
 */
export function distinctCardStyles(styles: CardStyleOption[]): CardStyleOption[] {
  const kept: CardStyleOption[] = [];
  for (const style of styles) {
    if (style.isCover) {
      kept.push(style);
    } else {
      const duplicate = kept.some((k) => !k.isCover && looksAlike(k.ground, style.ground));
      if (!duplicate) {
        kept.push(style);
      }
    }
  }
  return kept;
}

const DEFAULT_STYLES: CardStyleOption[] = [
  { id: "dark", label: "Dark", ground: "#121212", hex: "#121212", ink: "#ffffff", isLight: false },
  { id: "surface", label: "Surface", ground: "#242424", hex: "#242424", ink: "#f4f4f4", isLight: false },
  { id: "inverse", label: "Light", ground: "#f4f4f4", hex: "#f4f4f4", ink: "#111111", isLight: true },
  { id: "primary", label: "Accent", ground: "#e11d48", hex: "#e11d48", ink: "#ffffff", isLight: false },
  { id: "slate", label: "Slate", ground: "#1e293b", hex: "#1e293b", ink: "#ffffff", isLight: false },
];

async function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  const tryLoad = (useCors: boolean) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      if (useCors) img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });

  try {
    return await tryLoad(true);
  } catch {
    return await tryLoad(false);
  }
}

export async function extractArtworkPalette(
  coverUrl: string | null | undefined,
): Promise<CardStyleOption[]> {
  if (!coverUrl) {
    return DEFAULT_STYLES;
  }

  try {
    const img = await loadHtmlImage(coverUrl);

    if (img.naturalWidth === 0 || img.naturalHeight === 0) {
      return DEFAULT_STYLES;
    }

    const scale = Math.min(1, SAMPLE_SIDE / Math.sqrt(img.naturalWidth * img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return DEFAULT_STYLES;

    ctx.drawImage(img, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height).data;

    const { base, accent } = artworkSwatches(imageData);
    const quantized = quantizeSwatches(imageData);

    const candidates: CardStyleOption[] = [];

    // 1. COLORFUL (Cover blurred layer)
    candidates.push({
      id: "cover",
      label: "Cover",
      ground: "#121212",
      hex: "#121212",
      ink: "#ffffff",
      isCover: true,
      isLight: false,
    });

    // 2. ARTWORK (Dominant dark base from album art)
    if (base) {
      const ground = rgbToHex(base);
      candidates.push({
        id: "artwork",
        label: "Artwork",
        ground,
        hex: ground,
        ink: getContrastingInk(ground),
        isLight: isLightColor(ground),
      });
    }

    // 3. ARTWORK ACCENT (Vibrant accent from album art)
    if (accent) {
      const ground = rgbToHex(accent);
      candidates.push({
        id: "accent",
        label: "Accent",
        ground,
        hex: ground,
        ink: getContrastingInk(ground),
        isLight: isLightColor(ground),
      });
    }

    // 4. Quantized color candidates from album art
    const sorted = [...quantized].sort((a, b) => b.population - a.population);
    for (let i = 0; i < sorted.length && candidates.length < 8; i++) {
      const item = sorted[i];
      if (item) {
        const ground = rgbToHex(item.rgb);
        candidates.push({
          id: `palette-${i}`,
          label: `Color ${i + 1}`,
          ground,
          hex: ground,
          ink: getContrastingInk(ground),
          isLight: isLightColor(ground),
        });
      }
    }

    // 5. Standard Material / Flow roles
    candidates.push({
      id: "surface",
      label: "Surface",
      ground: "#242424",
      hex: "#242424",
      ink: "#f4f4f4",
      isLight: false,
    });
    candidates.push({
      id: "inverse",
      label: "Inverse",
      ground: "#f4f4f4",
      hex: "#f4f4f4",
      ink: "#111111",
      isLight: true,
    });
    candidates.push({
      id: "primary",
      label: "Primary",
      ground: "#e11d48",
      hex: "#e11d48",
      ink: "#ffffff",
      isLight: false,
    });

    const distinct = distinctCardStyles(candidates);
    return distinct.length > 0 ? distinct : DEFAULT_STYLES;
  } catch {
    return [
      {
        id: "cover",
        label: "Cover",
        ground: "#121212",
        hex: "#121212",
        ink: "#ffffff",
        isCover: true,
        isLight: false,
      },
      ...DEFAULT_STYLES,
    ];
  }
}
