import { LOGO_GLYPH_PATH, LOGO_SHAPE_BOUNDS, LOGO_SHAPE_PATH } from "../brand/logo";
import { fitText } from "../canvasImage";
import { css } from "../color/tone";
import { isRtlText } from "../direction";
import type { Rgb } from "../useDominantColor";
import { breakLines, type TextMeasurer } from "./display/textLayout";
import { MESH_SIZE } from "./display/coverMesh";
import type { CardStyle } from "./palette";

/**
 * Android's lyric card (LyricsCardLayouts.kt), laid out in its 360-unit design width and exported
 * 1080 px wide on every screen. Everything below is in design units.
 */
export const CARD_DESIGN_WIDTH = 360;
export const CARD_EXPORT_WIDTH = 1080;
const SCALE = CARD_EXPORT_WIDTH / CARD_DESIGN_WIDTH;

const PADDING = 24;
const SPACING = 14;
const HEADER_SPACING = 12;
const ARTWORK = 56;
const FOOTER_ARTWORK = 40;
const SHAPE_ARTWORK = 72;
const ARTWORK_RADIUS = 8;
const QUOTE = 56;
const DECOR = 220;
const DECOR_OVERHANG = 64;
const DECOR_TURN = (18 * Math.PI) / 180;
const LOGO_WIDTH = 28;
const LOGO_HEIGHT = LOGO_WIDTH * (LOGO_SHAPE_BOUNDS.height / LOGO_SHAPE_BOUNDS.width);
const LOGO_SPACING = 8;
const CARD_RADIUS = 28;
const BACKDROP_MARGIN = 24;
const SECONDARY_INK = 0.7;
const DIVIDER_INK = 0.2;
const QUOTE_INK = 0.55;
const DECOR_INK = 0.14;
const MIN_LINE_SCALE = 0.6;
const MAX_LINE_SCALE = 1.6;
const FIT_STEPS = 12;
// Material's FormatQuote, filled, in a 24-unit box.
const QUOTE_PATH = "M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z";

// Material 3 type roles, as size and line height.
const TITLE = { size: 16, height: 24, weight: 600 };
const ARTIST = { size: 14, height: 20, weight: 400 };
const MARK = { size: 14, height: 20, weight: 700 };
const LINE = { size: 24, height: 32 };
const POSTER_LINE = { size: 28, height: 36 };
const NAMES_HEIGHT = TITLE.height + ARTIST.height;

export type CardAlign = "left" | "center" | "right";
/** Android's LyricsCardLayout. */
export type CardLayout = "classic" | "poster" | "shape";
/** Android's LyricsCardAspect: as tall as the content, square, or a 9:16 story. */
export type CardAspect = "fit" | "square" | "story";
/** Android's LyricsCardFrame: square corners, rounded on a coloured margin, or rounded on nothing. */
export type CardFrame = "square" | "backdrop" | "clear";

export interface LyricCardData {
  lines: string[];
  title: string;
  artist: string;
}

export interface LyricCardLook {
  style: CardStyle;
  align: CardAlign;
  layout: CardLayout;
  aspect: CardAspect;
  frame: CardFrame;
  /** The margin's colour when the frame is a backdrop. */
  backdrop: Rgb;
  /** The app's font stack, so the card reads like the lyrics on screen. */
  fontFamily: string;
}

const font = (weight: number, size: number, family: string) => `${weight} ${size}px ${family}`;

export function aspectHeight(aspect: CardAspect, width: number): number | null {
  if (aspect === "square") return width;
  if (aspect === "story") return (width * 16) / 9;
  return null;
}

/** Android's largestFittingScale: the largest scale in min..max that fits, or min when nothing does. */
export function largestFittingScale(min: number, max: number, fits: (scale: number) => boolean): number {
  if (fits(max)) return max;
  if (!fits(min)) return min;
  let low = min;
  let high = max;
  for (let i = 0; i < FIT_STEPS; i++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return low;
}

export interface PlacedLine {
  text: string;
  /** The top of the line's box. */
  y: number;
  rtl: boolean;
}

export interface CardPlan {
  width: number;
  height: number;
  card: { x: number; y: number; width: number; height: number; radius: number };
  artwork: { x: number; y: number; size: number; clover: boolean };
  names: { x: number; y: number; width: number; centered: boolean };
  lines: { x: number; width: number; size: number; lineHeight: number; rows: PlacedLine[] };
  divider: { x: number; y: number; width: number } | null;
  quote: { x: number; y: number } | null;
  decor: { x: number; y: number } | null;
  /** The badge's top-left; the wordmark follows it unless `badgeOnly`. */
  mark: { x: number; y: number; badgeOnly: boolean };
}

interface Stack {
  rows: PlacedLine[];
  height: number;
}

/** The chosen lines, each broken to fit, stacked from `top`. */
function stackLines(lines: string[], width: number, size: number, lineHeight: number, family: string, measurer: TextMeasurer, top: number): Stack {
  const lineFont = font(700, size, family);
  const rows: PlacedLine[] = [];
  let y = top;
  lines.forEach((line, index) => {
    if (index > 0) y += SPACING;
    for (const row of breakLines(line, lineFont, width, measurer)) {
      rows.push({ text: row.text, y, rtl: row.rtl });
      y += lineHeight;
    }
  });
  return { rows, height: y - top };
}

/** Where everything goes. With a fixed size the lines grow or shrink to fill what the rest leaves, as Android's fill mode does. */
export function planLyricCard(data: LyricCardData, look: LyricCardLook, measurer: TextMeasurer): CardPlan {
  const framed = look.frame === "backdrop";
  const margin = framed ? BACKDROP_MARGIN : 0;
  const width = CARD_DESIGN_WIDTH;
  const cardWidth = width - margin * 2;
  const fixedHeight = aspectHeight(look.aspect, width);
  const inner = cardWidth - PADDING * 2;
  const base = look.layout === "poster" ? POSTER_LINE : LINE;
  const markWidth = LOGO_WIDTH + LOGO_SPACING + measurer.width("Flow", font(MARK.weight, MARK.size, look.fontFamily));

  // Heights above and below the lines, which don't change with the lines' scale.
  const above =
    look.layout === "classic"
      ? ARTWORK + SPACING + 1 + SPACING
      : look.layout === "poster"
        ? QUOTE + SPACING
        : SHAPE_ARTWORK + SPACING + NAMES_HEIGHT + SPACING;
  const below = look.layout === "poster" ? SPACING + NAMES_HEIGHT : SPACING + LOGO_HEIGHT;

  let scale = 1;
  let room = 0;
  if (fixedHeight !== null) {
    room = fixedHeight - margin * 2 - PADDING * 2 - above - below;
    scale = largestFittingScale(MIN_LINE_SCALE, MAX_LINE_SCALE, (candidate) =>
      stackLines(data.lines, inner, base.size * candidate, base.height * candidate, look.fontFamily, measurer, 0).height <= room,
    );
  }
  const size = base.size * scale;
  const lineHeight = base.height * scale;
  const cardTop = margin;
  const linesTop = cardTop + PADDING + above;
  let stack = stackLines(data.lines, inner, size, lineHeight, look.fontFamily, measurer, linesTop);
  if (fixedHeight !== null) {
    // The lines sit in the middle of the room they were fitted to.
    const offset = Math.max(0, (room - stack.height) / 2);
    stack = { rows: stack.rows.map((row) => ({ ...row, y: row.y + offset })), height: room };
  }
  const linesBottom = linesTop + stack.height;
  const cardHeight = fixedHeight !== null ? fixedHeight - margin * 2 : PADDING + above + stack.height + below + PADDING;
  const left = margin + PADDING;

  const plan: CardPlan = {
    width,
    height: cardHeight + margin * 2,
    card: { x: margin, y: margin, width: cardWidth, height: cardHeight, radius: look.frame === "square" ? 0 : CARD_RADIUS },
    artwork: { x: left, y: cardTop + PADDING, size: ARTWORK, clover: false },
    names: { x: left + ARTWORK + HEADER_SPACING, y: cardTop + PADDING + (ARTWORK - NAMES_HEIGHT) / 2, width: inner - ARTWORK - HEADER_SPACING, centered: false },
    lines: { x: left, width: inner, size, lineHeight, rows: stack.rows },
    divider: null,
    quote: null,
    decor: null,
    mark: { x: left, y: linesBottom + SPACING, badgeOnly: false },
  };

  if (look.layout === "classic") {
    plan.divider = { x: left, y: cardTop + PADDING + ARTWORK + SPACING, width: inner };
  } else if (look.layout === "poster") {
    const rowTop = linesBottom + SPACING;
    plan.quote = { x: left, y: cardTop + PADDING };
    plan.artwork = { x: left, y: rowTop + (NAMES_HEIGHT - FOOTER_ARTWORK) / 2, size: FOOTER_ARTWORK, clover: false };
    plan.names = {
      x: left + FOOTER_ARTWORK + HEADER_SPACING,
      y: rowTop,
      width: inner - FOOTER_ARTWORK - LOGO_WIDTH - HEADER_SPACING * 2,
      centered: false,
    };
    plan.mark = { x: left + inner - LOGO_WIDTH, y: rowTop + (NAMES_HEIGHT - LOGO_HEIGHT) / 2, badgeOnly: true };
  } else {
    const middle = margin + cardWidth / 2;
    plan.decor = { x: margin + cardWidth - DECOR + DECOR_OVERHANG, y: cardTop - DECOR_OVERHANG };
    plan.artwork = { x: middle - SHAPE_ARTWORK / 2, y: cardTop + PADDING, size: SHAPE_ARTWORK, clover: true };
    plan.names = { x: left, y: cardTop + PADDING + SHAPE_ARTWORK + SPACING, width: inner, centered: true };
    plan.mark = { x: middle - markWidth / 2, y: linesBottom + SPACING, badgeOnly: false };
  }
  return plan;
}

/** A rounded shape traced around a centre: `lobes` bumps of depth `depth` on a circle of `radius`. */
function lobedPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, lobes: number, depth: number, turn = 0) {
  const steps = 180;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const r = radius * (1 - depth + depth * Math.cos(lobes * angle));
    const x = cx + r * Math.cos(angle + turn);
    const y = cy + r * Math.sin(angle + turn);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
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

function drawMesh(ctx: CanvasRenderingContext2D, mesh: Uint8ClampedArray, x: number, y: number, width: number, height: number) {
  const field = document.createElement("canvas");
  field.width = MESH_SIZE;
  field.height = MESH_SIZE;
  field.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(mesh), MESH_SIZE, MESH_SIZE), 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(field, x, y, width, height);
}

/** The cover cropped to a square, as Android's ContentScale.Crop does. */
function drawArtwork(ctx: CanvasRenderingContext2D, art: HTMLImageElement, x: number, y: number, size: number) {
  const side = Math.min(art.naturalWidth || art.width, art.naturalHeight || art.height);
  const sx = ((art.naturalWidth || art.width) - side) / 2;
  const sy = ((art.naturalHeight || art.height) - side) / 2;
  ctx.drawImage(art, sx, sy, side, side, x, y, size, size);
}

/** One line of text in a box `width` wide, shaped right to left when its script is. */
function writeLine(ctx: CanvasRenderingContext2D, text: string, left: number, middle: number, width: number, align: CardAlign, rtl = isRtlText(text)) {
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  const x = align === "center" ? left + width / 2 : align === "right" ? left + width : left;
  ctx.fillText(text, x, middle);
}

/** Draws the planned card, in design units: the caller has scaled the context. */
export function drawLyricCard(
  ctx: CanvasRenderingContext2D,
  data: LyricCardData,
  look: LyricCardLook,
  plan: CardPlan,
  art: HTMLImageElement | null,
) {
  const { style, fontFamily } = look;
  const ink = css(style.ink);
  const { card } = plan;
  ctx.clearRect(0, 0, plan.width, plan.height);
  if (look.frame === "backdrop") {
    ctx.fillStyle = css(look.backdrop);
    ctx.fillRect(0, 0, plan.width, plan.height);
  }

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(card.x, card.y, card.width, card.height, card.radius);
  ctx.clip();
  ctx.fillStyle = css(style.ground);
  ctx.fillRect(card.x, card.y, card.width, card.height);
  if (style.mesh) drawMesh(ctx, style.mesh, card.x, card.y, card.width, card.height);

  if (plan.decor) {
    ctx.fillStyle = css(style.ink, DECOR_INK);
    lobedPath(ctx, plan.decor.x + DECOR / 2, plan.decor.y + DECOR / 2, DECOR / 2, 9, 0.08, DECOR_TURN);
    ctx.fill();
  }

  const { artwork } = plan;
  ctx.save();
  if (artwork.clover) {
    lobedPath(ctx, artwork.x + artwork.size / 2, artwork.y + artwork.size / 2, artwork.size / 2, 4, 0.18, Math.PI / 4);
  } else {
    ctx.beginPath();
    ctx.roundRect(artwork.x, artwork.y, artwork.size, artwork.size, ARTWORK_RADIUS);
  }
  ctx.clip();
  if (art) {
    drawArtwork(ctx, art, artwork.x, artwork.y, artwork.size);
  } else {
    ctx.fillStyle = css(style.ink, 0.12);
    ctx.fillRect(artwork.x, artwork.y, artwork.size, artwork.size);
  }
  ctx.restore();

  // Song names start where their script starts, or sit in the middle on the shape layout.
  const { names } = plan;
  const nameAlign = (text: string): CardAlign => (names.centered ? "center" : isRtlText(text) ? "right" : "left");
  ctx.fillStyle = ink;
  ctx.font = font(TITLE.weight, TITLE.size, fontFamily);
  const title = fitText(ctx, data.title, names.width);
  writeLine(ctx, title, names.x, names.y + TITLE.height / 2, names.width, nameAlign(title));
  if (data.artist) {
    ctx.fillStyle = css(style.ink, SECONDARY_INK);
    ctx.font = font(ARTIST.weight, ARTIST.size, fontFamily);
    const artist = fitText(ctx, data.artist, names.width);
    writeLine(ctx, artist, names.x, names.y + TITLE.height + ARTIST.height / 2, names.width, nameAlign(artist));
  }

  if (plan.divider) {
    ctx.fillStyle = css(style.ink, DIVIDER_INK);
    ctx.fillRect(plan.divider.x, plan.divider.y, plan.divider.width, 1);
  }
  if (plan.quote) {
    ctx.save();
    ctx.translate(plan.quote.x, plan.quote.y);
    ctx.scale(QUOTE / 24, QUOTE / 24);
    ctx.fillStyle = css(style.ink, QUOTE_INK);
    ctx.fill(new Path2D(QUOTE_PATH));
    ctx.restore();
  }

  const { lines } = plan;
  ctx.fillStyle = ink;
  ctx.font = font(700, lines.size, fontFamily);
  for (const row of lines.rows) writeLine(ctx, row.text, lines.x, row.y + lines.lineHeight / 2, lines.width, look.align, row.rtl);

  drawBadge(ctx, plan.mark.x, plan.mark.y, ink, css(style.ground));
  if (!plan.mark.badgeOnly) {
    ctx.fillStyle = ink;
    ctx.font = font(MARK.weight, MARK.size, fontFamily);
    writeLine(ctx, "Flow", plan.mark.x + LOGO_WIDTH + LOGO_SPACING, plan.mark.y + LOGO_HEIGHT / 2, MARK.size * 4, "left", false);
  }
  ctx.restore();
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
    await Promise.all([400, 600, 700].map((weight) => document.fonts.load(font(weight, 16, fontFamily))));
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
      const plan = planLyricCard(data, look, canvasMeasurer(ctx));
      canvas.width = CARD_EXPORT_WIDTH;
      canvas.height = Math.ceil(plan.height * SCALE);
      ctx.scale(SCALE, SCALE);
      try {
        drawLyricCard(ctx, data, look, plan, withArt);
        canvas.toBlob(resolve, "image/png");
      } catch {
        resolve(null);
      }
    });
  return (await encode(art)) ?? (art ? encode(null) : null);
}

/** The chosen lines with a "Song, Artist" credit under them, for the clipboard, as on Android. */
export function lyricsCopyText(lines: string[], title: string, artist: string): string {
  const credit = [title, artist].filter((part) => part.trim()).join(", ");
  return credit ? `${lines.join("\n")}\n\n${credit}` : lines.join("\n");
}
