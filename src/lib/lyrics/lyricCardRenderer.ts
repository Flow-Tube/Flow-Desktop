import { isLightColor } from "./palette";
import { LOGO_CONTAINER_PATH, LOGO_GLYPH_PATH, LOGO_ASPECT } from "../../components/ui/FlowLogo";
import { useImageProxyStore } from "../../store/useImageProxyStore";
import { proxiedImage } from "../imageProxy";
import { proxyImageUrl } from "../api/images";
import { upgradeMusicImageUrl } from "../thumbnails";

export type CardAlign = "left" | "center" | "right";

export interface LyricCardData {
  lines: string[];
  title: string;
  artist: string;
  coverUrl?: string | null;
}

export interface LyricCardOptions {
  theme: string; // "cover" or hex color string e.g. "#121212", "#ffffff", "#e11d48"
  align: CardAlign;
  targetWidth?: number;
  targetHeight?: number;
}

export const BASE_CARD_WIDTH = 340;
export const BASE_CARD_HEIGHT = 460;
export const EXPORT_SCALE = 2.5;
export const CARD_WIDTH = Math.round(BASE_CARD_WIDTH * EXPORT_SCALE); // 850

const FONT_FAMILY = '"Segoe UI", "Nirmala UI", -apple-system, BlinkMacSystemFont, Roboto, sans-serif';

function isAlreadyProxied(url: string): boolean {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(url);
}

/** Loads an image element reliably across local proxy and remote origins */
export async function loadCardImage(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url?.trim()) return null;
  let target = url.trim();
  if (target.startsWith("//")) {
    target = `https:${target}`;
  }

  // Upgrade resolution
  target = upgradeMusicImageUrl(target, 512) ?? target;

  // If already routed through local proxy, don't double proxy
  if (!isAlreadyProxied(target)) {
    try {
      const base = useImageProxyStore.getState().base;
      if (base) {
        target = proxiedImage(target, base);
      } else {
        target = await proxyImageUrl(target);
      }
    } catch {
      // Proceed with direct target
    }
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    const timer = setTimeout(() => resolve(null), 8000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      // Retry once without crossOrigin
      const fallback = new Image();
      fallback.decoding = "async";
      fallback.onload = () => {
        clearTimeout(timer);
        resolve(fallback);
      };
      fallback.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      fallback.src = target;
    };
    img.src = target;
  });
}

/** Splits text into wrapped lines that fit within maxWidth on a 2D canvas context. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = ctx.measureText(testLine).width;
    if (width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines.length > 0 ? lines : [text];
}

/** Truncates text with ellipsis if it exceeds maxWidth. */
function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && ctx.measureText(`${truncated}…`).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

/** Draws a rounded rectangle path. */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}

/** Draws the authentic Flow Logo onto the canvas using inverted card colors. */
export function drawFlowLogo(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  shapeColor: string,
  glyphColor: string,
  height?: number,
) {
  const actualHeight = height ?? Math.round(width / LOGO_ASPECT);
  const scale = Math.min(width / 24, actualHeight / 24);
  const dx = (width - 24 * scale) / 2;
  const dy = (actualHeight - 24 * scale) / 2;

  if (typeof Path2D !== "undefined") {
    try {
      const containerPath = new Path2D(LOGO_CONTAINER_PATH);
      const glyphPath = new Path2D(LOGO_GLYPH_PATH);

      ctx.save();
      ctx.translate(x + dx, y + dy);
      ctx.scale(scale, scale);

      ctx.fillStyle = shapeColor;
      ctx.fill(containerPath);

      ctx.fillStyle = glyphColor;
      ctx.fill(glyphPath);

      ctx.restore();
      return;
    } catch {
      // Fallback below
    }
  }

  // Graceful fallback for non-Path2D environments (e.g., bare jsdom)
  ctx.save();
  ctx.fillStyle = shapeColor;
  ctx.beginPath();
  roundRect(ctx, x, y, width, actualHeight, Math.round(actualHeight * 0.25));
  ctx.fill();

  ctx.fillStyle = glyphColor;
  ctx.font = `italic 900 ${Math.round(actualHeight * 0.6)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("F", x + width / 2, y + actualHeight / 2);
  ctx.restore();
}

/**
 * Calculates the exact pixel height needed to render the card contents comfortably
 * based on the number of lines and text wrapping, ensuring generous breathing room
 * around the lyrics and bottom Flow logo.
 */
export function calculateCardHeight(
  ctx: CanvasRenderingContext2D | null,
  data: LyricCardData,
  targetWidth: number = BASE_CARD_WIDTH,
  scale: number = EXPORT_SCALE,
): number {
  const topPadding = Math.round(24 * scale);
  const bottomPadding = Math.round(28 * scale);
  const artSize = Math.round(56 * scale);
  const gapSections = Math.round(16 * scale);
  const logoWidth = Math.round(28 * scale);
  const logoHeight = Math.round(logoWidth / LOGO_ASPECT);
  const maxLyricsWidth = Math.round(targetWidth * scale) - topPadding * 2;

  const baseLyricSize =
    data.lines.length <= 2 ? 24 : data.lines.length <= 3 ? 20 : 18;
  const lyricFontSize = Math.round(baseLyricSize * scale);
  const lyricLineHeight = Math.round(lyricFontSize * 1.3);
  const blockGap = Math.round((data.lines.length <= 3 ? 12 : 10) * scale);

  const dividerY = topPadding + artSize + Math.round(14 * scale);
  let currentY = dividerY + gapSections + Math.round(4 * scale);

  if (ctx) {
    ctx.font = `700 ${lyricFontSize}px ${FONT_FAMILY}`;
    let b = 0;
    for (const line of data.lines) {
      if (!line) continue;
      const wrapped = wrapText(ctx, line, maxLyricsWidth);
      currentY += wrapped.length * lyricLineHeight;
      if (b < data.lines.length - 1) {
        currentY += blockGap;
      }
      b++;
    }
  } else {
    currentY += data.lines.length * lyricLineHeight + Math.max(0, data.lines.length - 1) * blockGap;
  }

  // Generous breathing space (28dp) above Flow logo so it never feels squished
  const gapBeforeFooter = Math.round(28 * scale);
  const footerY = currentY + gapBeforeFooter;
  return footerY + logoHeight + bottomPadding;
}

/**
 * Draws the entire lyric card onto the canvas with dynamic length based on line count,
 * generous breathing room, and the authentic Flow logo footer.
 */
export function drawLyricCard(
  ctx: CanvasRenderingContext2D,
  data: LyricCardData,
  options: LyricCardOptions,
  coverImage: HTMLImageElement | null,
  canvasWidth?: number,
  canvasHeight?: number,
) {
  const targetW = options.targetWidth && options.targetWidth > 0 ? options.targetWidth : BASE_CARD_WIDTH;
  const scale = canvasWidth ? canvasWidth / targetW : EXPORT_SCALE;
  const finalCanvasWidth = canvasWidth ?? Math.round(targetW * scale);

  const calculatedMinHeight = calculateCardHeight(ctx, data, targetW, scale);
  const finalCanvasHeight =
    canvasHeight ??
    (options.targetHeight && options.targetHeight > 0
      ? Math.max(Math.round(options.targetHeight * scale), calculatedMinHeight)
      : calculatedMinHeight);

  // Clear canvas first to guarantee transparent pixels outside the card radius
  ctx.clearRect(0, 0, finalCanvasWidth, finalCanvasHeight);

  const isLight = isLightColor(options.theme);
  const ink = isLight ? "#111111" : "#ffffff";
  const mutedInk = isLight ? "rgba(17, 17, 17, 0.70)" : "rgba(255, 255, 255, 0.70)";
  const dividerColor = isLight ? "rgba(17, 17, 17, 0.20)" : "rgba(255, 255, 255, 0.20)";
  const groundColor = options.theme === "cover" ? "#141416" : options.theme;

  const padding = Math.round(24 * scale);
  const bottomPadding = Math.round(28 * scale);
  const cornerRadius = Math.round(28 * scale);
  const artSize = Math.round(56 * scale);
  const artRadius = Math.round(8 * scale);
  const gapHeader = Math.round(12 * scale);
  const gapSections = Math.round(16 * scale);
  const logoWidth = Math.round(28 * scale);
  const logoHeight = Math.round(logoWidth / LOGO_ASPECT);

  // 1. Clip card bounds with rounded corners - ensures 100% transparent corners outside
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, 0, 0, finalCanvasWidth, finalCanvasHeight, cornerRadius);
  ctx.clip();

  // 2. Card Background
  if (options.theme === "cover" && coverImage) {
    ctx.save();
    try {
      if ("filter" in ctx) {
        ctx.filter = "blur(32px) brightness(0.65)";
      }
      ctx.drawImage(
        coverImage,
        -finalCanvasWidth * 0.15,
        -finalCanvasHeight * 0.15,
        finalCanvasWidth * 1.3,
        finalCanvasHeight * 1.3,
      );
    } catch {
      ctx.drawImage(coverImage, 0, 0, finalCanvasWidth, finalCanvasHeight);
    }
    ctx.restore();

    // Dark gradient overlay for 7:1 text contrast
    const grad = ctx.createLinearGradient(0, 0, 0, finalCanvasHeight);
    grad.addColorStop(0, "rgba(8, 8, 14, 0.45)");
    grad.addColorStop(0.5, "rgba(8, 8, 14, 0.65)");
    grad.addColorStop(1, "rgba(4, 4, 8, 0.85)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, finalCanvasWidth, finalCanvasHeight);
  } else if (options.theme === "cover") {
    const grad = ctx.createLinearGradient(0, 0, finalCanvasWidth, finalCanvasHeight);
    grad.addColorStop(0, "#2a1542");
    grad.addColorStop(0.5, "#181028");
    grad.addColorStop(1, "#0a0712");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, finalCanvasWidth, finalCanvasHeight);
  } else {
    ctx.fillStyle = options.theme;
    ctx.fillRect(0, 0, finalCanvasWidth, finalCanvasHeight);
  }

  // 3. Header: Album Artwork (56dp proportional) + Song Title & Artist
  const headerX = padding;
  const headerY = padding;

  // Cover art thumbnail
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, headerX, headerY, artSize, artSize, artRadius);
  ctx.clip();
  if (coverImage) {
    ctx.drawImage(coverImage, headerX, headerY, artSize, artSize);
  } else {
    ctx.fillStyle = isLight ? "rgba(0, 0, 0, 0.08)" : "rgba(255, 255, 255, 0.1)";
    ctx.fillRect(headerX, headerY, artSize, artSize);
    ctx.fillStyle = mutedInk;
    ctx.font = `bold ${Math.round(24 * scale)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("♪", headerX + artSize / 2, headerY + artSize / 2);
  }
  ctx.restore();

  // Song Title & Artist Text
  const textX = headerX + artSize + gapHeader;
  const maxTitleWidth = finalCanvasWidth - textX - padding;

  const titleFontSize = Math.round(16 * scale);
  const artistFontSize = Math.round(14 * scale);

  ctx.font = `600 ${titleFontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = ink;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const titleText = truncateText(ctx, data.title || "Unknown Title", maxTitleWidth);
  ctx.fillText(titleText, textX, headerY + Math.round(6 * scale));

  ctx.font = `500 ${artistFontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = mutedInk;
  const artistText = truncateText(ctx, data.artist || "Unknown Artist", maxTitleWidth);
  ctx.fillText(artistText, textX, headerY + Math.round(30 * scale));

  // Horizontal divider with 20% alpha
  const dividerY = headerY + artSize + Math.round(14 * scale);
  ctx.strokeStyle = dividerColor;
  ctx.lineWidth = Math.max(1, Math.round(1 * scale));
  ctx.beginPath();
  ctx.moveTo(padding, dividerY);
  ctx.lineTo(finalCanvasWidth - padding, dividerY);
  ctx.stroke();

  // 4. Lyrics Lines - scaled precisely to match the rendered preview text wrapping
  const baseLyricSize =
    data.lines.length <= 2 ? 24 : data.lines.length <= 3 ? 20 : 18;
  const lyricFontSize = Math.round(baseLyricSize * scale);
  const lyricLineHeight = Math.round(lyricFontSize * 1.25);
  const blockGap = Math.round(8 * scale);
  const maxLyricsWidth = finalCanvasWidth - padding * 2;

  ctx.font = `700 ${lyricFontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = ink;
  ctx.textBaseline = "top";

  let alignX = padding;
  if (options.align === "center") {
    alignX = finalCanvasWidth / 2;
    ctx.textAlign = "center";
  } else if (options.align === "right") {
    alignX = finalCanvasWidth - padding;
    ctx.textAlign = "right";
  } else {
    alignX = padding;
    ctx.textAlign = "left";
  }

  const wrappedBlocks: string[][] = [];
  for (const line of data.lines) {
    wrappedBlocks.push(wrapText(ctx, line, maxLyricsWidth));
  }

  let currentY = dividerY + gapSections + Math.round(4 * scale);
  for (let b = 0; b < wrappedBlocks.length; b++) {
    const block = wrappedBlocks[b];
    if (!block) continue;
    for (const line of block) {
      ctx.fillText(line, alignX, currentY);
      currentY += lyricLineHeight;
    }
    if (b < wrappedBlocks.length - 1) {
      currentY += blockGap;
    }
  }

  // 5. Footer: Flow Branding - sits with generous breathing room below lyrics
  const gapBeforeFooter = Math.round(28 * scale);
  const footerY = Math.max(
    currentY + gapBeforeFooter,
    finalCanvasHeight - bottomPadding - logoHeight,
  );
  const logoX = padding;

  drawFlowLogo(ctx, logoX, footerY, logoWidth, ink, groundColor, logoHeight);

  // "Flow" wordmark next to logo - vertically aligned with the badge
  const logoTextSize = Math.round(14 * scale);
  ctx.font = `700 ${logoTextSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = ink;
  ctx.textAlign = "left";

  const centerY = footerY + logoHeight / 2;
  const metrics = ctx.measureText("Flow");
  const ascent = metrics.actualBoundingBoxAscent;
  const descent = metrics.actualBoundingBoxDescent;
  if (typeof ascent === "number" && typeof descent === "number" && ascent > 0) {
    ctx.textBaseline = "alphabetic";
    ctx.fillText(
      "Flow",
      logoX + logoWidth + Math.round(8 * scale),
      centerY + (ascent - descent) / 2,
    );
  } else {
    ctx.textBaseline = "middle";
    ctx.fillText("Flow", logoX + logoWidth + Math.round(8 * scale), centerY);
  }

  ctx.restore();
}

/** Renders the lyric card to a PNG Blob matching the exact aspect ratio of the rendered preview */
export async function renderLyricCardBlob(
  data: LyricCardData,
  options: LyricCardOptions,
): Promise<Blob | null> {
  const coverImage = data.coverUrl ? await loadCardImage(data.coverUrl) : null;
  return new Promise((resolve) => {
    const targetW = options.targetWidth && options.targetWidth > 0 ? options.targetWidth : BASE_CARD_WIDTH;
    const canvasWidth = Math.round(targetW * EXPORT_SCALE);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      resolve(null);
      return;
    }

    const calculatedHeight = calculateCardHeight(ctx, data, targetW, EXPORT_SCALE);
    const canvasHeight =
      options.targetHeight && options.targetHeight > 0
        ? Math.max(Math.round(options.targetHeight * EXPORT_SCALE), calculatedHeight)
        : calculatedHeight;

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    try {
      drawLyricCard(ctx, data, options, coverImage, canvasWidth, canvasHeight);
      canvas.toBlob((blob) => resolve(blob), "image/png");
    } catch (err) {
      console.warn("Failed to render lyric card to blob", err);
      resolve(null);
    }
  });
}
