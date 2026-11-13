import { LOGO_GLYPH_PATH, LOGO_SHAPE_BOUNDS, LOGO_SHAPE_PATH } from "../brand/logo";
import { fitText } from "../canvasImage";
import { css } from "../color/tone";
import { isRtlText } from "../direction";
import { breakLines, type TextMeasurer } from "./display/textLayout";
import { MESH_SIZE } from "./display/coverMesh";
import type { CardStyle } from "./palette";

/** The card is laid out on a 340-unit-wide design, as on Android, and exported 1080 px wide on every screen. */
export const CARD_DESIGN_WIDTH = 340;
export const CARD_EXPORT_WIDTH = 1080;
const SCALE = CARD_EXPORT_WIDTH / CARD_DESIGN_WIDTH;

const PADDING = 24;
const BOTTOM_PADDING = 28;
const CORNER_RADIUS = 28;
const ART_SIZE = 56;
const ART_RADIUS = 8;
const HEADER_GAP = 12;
const TITLE_SIZE = 16;
const ARTIST_SIZE = 14;
const DIVIDER_GAP = 14;
const LYRICS_GAP = 20;
const FOOTER_GAP = 28;
const LOGO_WIDTH = 28;
const LOGO_HEIGHT = LOGO_WIDTH * (LOGO_SHAPE_BOUNDS.height / LOGO_SHAPE_BOUNDS.width);
const WORDMARK_SIZE = 14;
const WORDMARK_GAP = 8;

const font = (weight: number, size: number, family: string) => `${weight} ${size}px ${family}`;

export type CardAlign = "left" | "center" | "right";

export interface LyricCardData {
  lines: string[];
  title: string;
  artist: string;
}

export interface LyricCardLook {
  style: CardStyle;
  align: CardAlign;
  /** The app's font stack, so the card reads like the lyrics on screen. */
  fontFamily: string;
}

/** Fewer lines get bigger type, as on Android's card. */
export function lyricFontSize(lineCount: number): number {
  return lineCount <= 2 ? 24 : lineCount <= 3 ? 20 : 18;
}

const lineGap = (lineCount: number) => (lineCount <= 3 ? 12 : 10);

export interface CardLayout {
  height: number;
  titleY: number;
  artistY: number;
  dividerY: number;
  fontSize: number;
  lineHeight: number;
  lines: { text: string; y: number; rtl: boolean }[];
  footerY: number;
}

/**
 * Where everything on the card goes, in design units; the canvas multiplies it by the export scale.
 * Lines break with the lyrics screen's own layout, so Japanese, Chinese and Thai lines, which have
 * no spaces, still break inside the card.
 */
export function layoutLyricCard(data: LyricCardData, measurer: TextMeasurer, fontFamily: string): CardLayout {
  const fontSize = lyricFontSize(data.lines.length);
  const lineHeight = Math.round(fontSize * 1.25);
  const lyricFont = font(700, fontSize, fontFamily);
  const maxWidth = CARD_DESIGN_WIDTH - PADDING * 2;
  const dividerY = PADDING + ART_SIZE + DIVIDER_GAP;
  let y = dividerY + LYRICS_GAP;
  const lines: CardLayout["lines"] = [];
  data.lines.forEach((lyric, index) => {
    if (index > 0) y += lineGap(data.lines.length);
    for (const row of breakLines(lyric, lyricFont, maxWidth, measurer)) {
      lines.push({ text: row.text, y, rtl: row.rtl });
      y += lineHeight;
    }
  });
  const footerY = y + FOOTER_GAP;
  return {
    height: Math.ceil(footerY + LOGO_HEIGHT + BOTTOM_PADDING),
    titleY: PADDING + 8,
    artistY: PADDING + 30,
    dividerY,
    fontSize,
    lineHeight,
    lines,
    footerY,
  };
}

function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, shape: string, glyph: string) {
  const unit = LOGO_WIDTH / LOGO_SHAPE_BOUNDS.width;
  ctx.save();
  ctx.translate(x - LOGO_SHAPE_BOUNDS.x * unit, y - LOGO_SHAPE_BOUNDS.y * unit);
  ctx.scale(unit, unit);
  ctx.fillStyle = shape;
  ctx.fill(new Path2D(LOGO_SHAPE_PATH));
  ctx.fillStyle = glyph;
  ctx.fill(new Path2D(LOGO_GLYPH_PATH));
  ctx.restore();
}

function drawMesh(ctx: CanvasRenderingContext2D, mesh: Uint8ClampedArray, width: number, height: number) {
  const field = document.createElement("canvas");
  field.width = MESH_SIZE;
  field.height = MESH_SIZE;
  field.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(mesh), MESH_SIZE, MESH_SIZE), 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(field, 0, 0, width, height);
}

/** Draws the card in design units; the caller has scaled the context. Corners outside the card stay transparent. */
export function drawLyricCard(
  ctx: CanvasRenderingContext2D,
  data: LyricCardData,
  look: LyricCardLook,
  layout: CardLayout,
  art: HTMLImageElement | null,
) {
  const { style, align, fontFamily } = look;
  const width = CARD_DESIGN_WIDTH;
  const ink = css(style.ink);
  ctx.clearRect(0, 0, width, layout.height);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, width, layout.height, CORNER_RADIUS);
  ctx.clip();

  ctx.fillStyle = css(style.ground);
  ctx.fillRect(0, 0, width, layout.height);
  if (style.mesh) drawMesh(ctx, style.mesh, width, layout.height);

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(PADDING, PADDING, ART_SIZE, ART_SIZE, ART_RADIUS);
  ctx.clip();
  if (art) {
    ctx.drawImage(art, PADDING, PADDING, ART_SIZE, ART_SIZE);
  } else {
    ctx.fillStyle = css(style.ink, 0.12);
    ctx.fillRect(PADDING, PADDING, ART_SIZE, ART_SIZE);
  }
  ctx.restore();

  const textX = PADDING + ART_SIZE + HEADER_GAP;
  const textWidth = width - textX - PADDING;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = ink;
  ctx.font = font(600, TITLE_SIZE, fontFamily);
  const titleTop = data.artist ? layout.titleY : layout.titleY + ARTIST_SIZE / 2 + 2;
  writeLine(ctx, fitText(ctx, data.title, textWidth), textX, titleTop, textWidth, "left");
  if (data.artist) {
    ctx.fillStyle = css(style.ink, 0.7);
    ctx.font = font(500, ARTIST_SIZE, fontFamily);
    writeLine(ctx, fitText(ctx, data.artist, textWidth), textX, layout.artistY, textWidth, "left");
  }

  ctx.fillStyle = css(style.ink, 0.2);
  ctx.fillRect(PADDING, layout.dividerY, width - PADDING * 2, 1);

  ctx.fillStyle = ink;
  ctx.font = font(700, layout.fontSize, fontFamily);
  for (const line of layout.lines) writeLine(ctx, line.text, PADDING, line.y, width - PADDING * 2, align, line.rtl);

  drawBadge(ctx, PADDING, layout.footerY, ink, css(style.ground));
  ctx.font = font(700, WORDMARK_SIZE, fontFamily);
  ctx.textBaseline = "middle";
  ctx.direction = "ltr";
  ctx.textAlign = "left";
  ctx.fillText("Flow", PADDING + LOGO_WIDTH + WORDMARK_GAP, layout.footerY + LOGO_HEIGHT / 2);
  ctx.restore();
}

/** One line at the card's left, middle or right, shaped right to left when its script is. */
function writeLine(ctx: CanvasRenderingContext2D, text: string, left: number, top: number, width: number, align: CardAlign, rtl = isRtlText(text)) {
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = align;
  const x = align === "center" ? left + width / 2 : align === "right" ? left + width : left;
  ctx.fillText(text, x, top);
}

function canvasMeasurer(ctx: CanvasRenderingContext2D): TextMeasurer {
  return {
    width(text, textFont) {
      ctx.font = textFont;
      return ctx.measureText(text).width;
    },
    extent(textFont, size) {
      ctx.font = textFont;
      const metrics = ctx.measureText("Hg");
      return { ascent: metrics.actualBoundingBoxAscent || size * 0.8, descent: metrics.actualBoundingBoxDescent || size * 0.2 };
    },
  };
}

async function fontsReady(fontFamily: string) {
  try {
    await Promise.all([500, 600, 700].map((weight) => document.fonts.load(font(weight, 16, fontFamily))));
  } catch {
    // Without the web font the card still draws, in the fallback face.
  }
}

/** The card as a 1080 px PNG. If the cover can't be read back it draws again without it, so a card always comes out. */
export async function renderLyricCardBlob(data: LyricCardData, look: LyricCardLook, art: HTMLImageElement | null): Promise<Blob | null> {
  await fontsReady(look.fontFamily);
  const encode = (withArt: HTMLImageElement | null) =>
    new Promise<Blob | null>((resolve) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      const layout = layoutLyricCard(data, canvasMeasurer(ctx), look.fontFamily);
      canvas.width = CARD_EXPORT_WIDTH;
      canvas.height = Math.ceil(layout.height * SCALE);
      ctx.scale(SCALE, SCALE);
      try {
        drawLyricCard(ctx, data, look, layout, withArt);
        canvas.toBlob(resolve, "image/png");
      } catch {
        resolve(null);
      }
    });
  return (await encode(art)) ?? (art ? encode(null) : null);
}
