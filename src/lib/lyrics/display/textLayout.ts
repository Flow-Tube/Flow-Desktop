/**
 * One text layout for every lyric row, so a line wraps the same whether it is drawn as text or on
 * the karaoke canvas: widths come from canvas `measureText`, break opportunities from
 * `Intl.Segmenter` words (after spaces and hyphens, and between CJK characters).
 */

export interface TextMeasurer {
  width(text: string, font: string): number;
  /** The font's ascent and descent in px, which set a row's natural height. */
  extent(font: string, size: number): { ascent: number; descent: number };
}

export interface LaidOutRow {
  /** Character span in the source text: [start, end), trailing spaces excluded. */
  start: number;
  end: number;
  text: string;
  width: number;
  rtl: boolean;
}

export interface TextStyleSpec {
  size: number;
  weight: number;
  italic: boolean;
  family: string;
  lineSpacing: number;
}

export interface TextBlock {
  rows: LaidOutRow[];
  font: string;
  lineHeight: number;
  ascent: number;
  /** Rows sit `lineHeight` apart; the first and last lose their extra leading, as Android's Trim.Both. */
  height: number;
}

export const fontOf = (style: TextStyleSpec): string =>
  `${style.italic ? "italic " : ""}${style.weight} ${style.size}px ${style.family}`;

const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const STRONG_CHAR = /[\p{L}]/u;

/** The direction of the first strong character, as the Unicode bidi algorithm picks a paragraph's. */
export function isRtlText(text: string): boolean {
  for (const char of text) {
    if (STRONG_CHAR.test(char)) return RTL_CHAR.test(char);
  }
  return false;
}

const isCjkChar = (char: string): boolean => /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/.test(char);

interface Piece {
  start: number;
  end: number;
  space: boolean;
}

interface SegmenterLike {
  segment(input: string): Iterable<{ segment: string; index: number }>;
}
type SegmenterCtor = new (locale?: string, options?: { granularity: string }) => SegmenterLike;

let wordSegmenter: SegmenterLike | null = null;
let graphemeSegmenter: SegmenterLike | null = null;

function segmenter(granularity: "word" | "grapheme"): SegmenterLike | null {
  const Ctor = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (!Ctor) return null;
  if (granularity === "word") return (wordSegmenter ??= new Ctor(undefined, { granularity }));
  return (graphemeSegmenter ??= new Ctor(undefined, { granularity }));
}

/** Pieces a line may break between: words with their trailing punctuation, spaces, CJK characters. */
function pieces(text: string): Piece[] {
  const result: Piece[] = [];
  const words = segmenter("word");
  const raw: Array<{ start: number; end: number }> = words
    ? Array.from(words.segment(text), (s) => ({ start: s.index, end: s.index + s.segment.length }))
    : Array.from(text.matchAll(/\s+|\S+/g), (m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  // Ideographs may break anywhere, so a CJK word becomes one piece per character.
  const split = raw.flatMap(({ start, end }) => {
    const chunk = text.slice(start, end);
    if (!Array.from(chunk).some(isCjkChar)) return [{ start, end }];
    const chars: Array<{ start: number; end: number }> = [];
    let at = start;
    for (const char of chunk) {
      chars.push({ start: at, end: at + char.length });
      at += char.length;
    }
    return chars;
  });
  for (const { start, end } of split) {
    const chunk = text.slice(start, end);
    const space = /^\s+$/.test(chunk);
    const previous = result[result.length - 1];
    const prevText = previous ? text.slice(previous.start, previous.end) : "";
    const punctuation = !/[\p{L}\p{N}]/u.test(chunk);
    const joins =
      previous &&
      !previous.space &&
      !space &&
      (punctuation || (!prevText.endsWith("-") && !isCjkChar(chunk[0]!) && !isCjkChar(prevText[prevText.length - 1]!)));
    if (joins) previous.end = end;
    else result.push({ start, end, space });
  }
  return result;
}

function graphemeEnds(text: string, start: number, end: number): number[] {
  const slice = text.slice(start, end);
  const seg = segmenter("grapheme");
  if (seg) return Array.from(seg.segment(slice), (s) => start + s.index + s.segment.length);
  const ends: number[] = [];
  let i = start;
  for (const char of slice) ends.push((i += char.length));
  return ends;
}

/** Greedy line breaking; a piece wider than the line is broken between its graphemes. */
export function breakLines(text: string, font: string, maxWidth: number, measurer: TextMeasurer): LaidOutRow[] {
  const rows: LaidOutRow[] = [];
  const fits = (from: number, to: number) => measurer.width(text.slice(from, to), font) <= maxWidth;
  let start = -1;
  let end = -1;
  const push = () => {
    if (start >= 0 && end > start) {
      const rowText = text.slice(start, end);
      rows.push({ start, end, text: rowText, width: measurer.width(rowText, font), rtl: isRtlText(rowText) });
    }
    start = -1;
    end = -1;
  };

  for (const piece of pieces(text)) {
    if (piece.space) continue;
    if (start >= 0 && fits(start, piece.end)) {
      end = piece.end;
      continue;
    }
    push();
    if (fits(piece.start, piece.end)) {
      start = piece.start;
      end = piece.end;
      continue;
    }
    let graphemeStart = piece.start;
    for (const graphemeEnd of graphemeEnds(text, piece.start, piece.end)) {
      if (start >= 0 && !fits(start, graphemeEnd)) push();
      if (start < 0) start = graphemeStart;
      end = graphemeEnd;
      graphemeStart = graphemeEnd;
    }
  }
  push();
  return rows;
}

export function layoutText(text: string, style: TextStyleSpec, maxWidth: number, measurer: TextMeasurer): TextBlock {
  const font = fontOf(style);
  const { ascent, descent } = measurer.extent(font, style.size);
  const lineHeight = style.size * style.lineSpacing;
  const rows = text.trim() ? breakLines(text, font, Math.max(1, maxWidth), measurer) : [];
  const height = rows.length === 0 ? 0 : (rows.length - 1) * lineHeight + ascent + descent;
  return { rows, font, lineHeight, ascent, height };
}

/** Where a row's text starts, for the alignment its line takes. */
export function rowX(row: LaidOutRow, width: number, align: "left" | "center" | "right"): number {
  if (align === "left") return 0;
  if (align === "right") return width - row.width;
  return (width - row.width) / 2;
}

const MEASURE_CACHE_LIMIT = 4000;

/** A measurer over one shared 2D context, caching widths, which lyrics ask for again and again. */
export function createCanvasMeasurer(): TextMeasurer {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const widths = new Map<string, number>();
  const extents = new Map<string, { ascent: number; descent: number }>();
  return {
    width(text, font) {
      const key = `${font}\u0000${text}`;
      const cached = widths.get(key);
      if (cached !== undefined) return cached;
      if (!ctx) return text.length * 0.55 * Number.parseFloat(font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? "16");
      ctx.font = font;
      const width = ctx.measureText(text).width;
      if (widths.size > MEASURE_CACHE_LIMIT) widths.clear();
      widths.set(key, width);
      return width;
    },
    extent(font, size) {
      const cached = extents.get(font);
      if (cached) return cached;
      let ascent = size * 0.97;
      let descent = size * 0.24;
      if (ctx) {
        ctx.font = font;
        const m = ctx.measureText("Hg");
        if (m.fontBoundingBoxAscent > 0) {
          ascent = m.fontBoundingBoxAscent;
          descent = m.fontBoundingBoxDescent;
        }
      }
      const extent = { ascent, descent };
      extents.set(font, extent);
      return extent;
    },
  };
}
