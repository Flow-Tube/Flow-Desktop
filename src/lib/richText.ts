import type { RichEmoji, RichStyle, RichTarget, RichText } from "../types/video";

export interface RichSegment {
  text: string;
  target?: RichTarget;
  emoji?: RichEmoji;
  /** Bold, italic or struck through, when a style run covers the piece. */
  style?: Pick<RichStyle, "bold" | "italic" | "strikethrough">;
  /** The index of the highlight chip the piece sits on; pieces of one chip are drawn as one. */
  highlight?: number;
  /** The piece is part of what a search found. */
  found?: boolean;
}

// Each pattern's first group is what may precede the match and the second the match itself.
// Lookbehind would say this more simply, but older WebKit builds reject it outright.
const URL_PATTERN = /()(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'”’])/g;
const TIMESTAMP_PATTERN = /(^|[^\d:])((?:\d{1,2}:)?\d{1,2}:\d{2})(?![\d:])/g;
const HASHTAG_PATTERN = /(^|[^\p{L}\p{N}_&#/])(#[\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*)/gu;

function toSeconds(stamp: string): number {
  return stamp.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

/**
 * Links in plain text, for text YouTube sent without its own: web links, timestamps (moments of
 * the current video) and hashtags. URLs win where patterns overlap, so a timestamp inside a link
 * stays part of the link.
 */
export function linkifyPlain(text: string): RichText {
  const spans: RichText["spans"] = [];
  const taken: [number, number][] = [];
  const free = (start: number, end: number) => taken.every(([from, to]) => end <= from || start >= to);
  const add = (pattern: RegExp, target: (match: string) => RichTarget) => {
    for (const match of text.matchAll(pattern)) {
      const found = match[2] ?? "";
      const start = (match.index ?? 0) + (match[1]?.length ?? 0);
      const end = start + found.length;
      if (!found || !free(start, end)) continue;
      taken.push([start, end]);
      spans.push({ start, length: found.length, target: target(found) });
    }
  };
  add(URL_PATTERN, (url) => ({ kind: "url", url }));
  add(TIMESTAMP_PATTERN, (stamp) => ({ kind: "timestamp", seconds: toSeconds(stamp) }));
  add(HASHTAG_PATTERN, (tag) => ({ kind: "hashtag", tag }));
  spans.sort((a, b) => a.start - b.start);
  return { text, spans, emojis: [] };
}

/**
 * `rich` cut into plain, linked and emoji pieces, in order. A run overlapping an earlier one is
 * dropped. An icon YouTube inserts before or inside a link is placed where it points, splitting the
 * link around it, as Flow for Android's inline images do.
 */
export function richSegments(rich: RichText): RichSegment[] {
  const marks = [
    ...rich.spans.map((span) => ({ start: span.start, end: span.start + span.length, target: span.target })),
    ...rich.emojis
      .filter((emoji) => emoji.length > 0)
      .map((emoji) => ({ start: emoji.start, end: emoji.start + emoji.length, emoji })),
  ].sort((a, b) => a.start - b.start);
  const segments: RichSegment[] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start < cursor || mark.end > rich.text.length) continue;
    if (mark.start > cursor) segments.push({ text: rich.text.slice(cursor, mark.start) });
    const text = rich.text.slice(mark.start, mark.end);
    segments.push("emoji" in mark ? { text, emoji: mark.emoji } : { text, target: mark.target });
    cursor = mark.end;
  }
  if (cursor < rich.text.length) segments.push({ text: rich.text.slice(cursor) });
  const withIcons = insertIcons(segments, rich.emojis.filter((emoji) => emoji.length === 0));
  const styled = rich.styles?.length ? splitAtStyles(withIcons, rich.styles) : withIcons;
  return rich.highlights?.length ? markHighlights(styled, rich.highlights) : styled;
}

/** Puts each zero-length icon at its offset, cutting the piece it falls in; the halves keep its link. */
function insertIcons(segments: RichSegment[], icons: RichText["emojis"]): RichSegment[] {
  if (icons.length === 0) return segments;
  const sorted = [...icons].sort((a, b) => a.start - b.start);
  const pieces: RichSegment[] = [];
  let offset = 0;
  let next = 0;
  for (const segment of segments) {
    const start = offset;
    const end = offset + segment.text.length;
    offset = end;
    if (segment.emoji) {
      while (next < sorted.length && sorted[next]!.start <= start) pieces.push({ text: "", emoji: sorted[next++]! });
      pieces.push(segment);
      continue;
    }
    let from = start;
    while (next < sorted.length && sorted[next]!.start < end) {
      const at = sorted[next++]!;
      if (at.start > from) pieces.push({ ...segment, text: segment.text.slice(from - start, at.start - start) });
      pieces.push({ text: "", emoji: at });
      from = Math.max(from, at.start);
    }
    if (from < end) pieces.push({ ...segment, text: segment.text.slice(from - start) });
  }
  while (next < sorted.length) pieces.push({ text: "", emoji: sorted[next++]! });
  return pieces;
}

/** Cuts pieces where a highlight starts or ends and marks the ones on it. An inserted icon at its start belongs to it. */
function markHighlights(segments: RichSegment[], highlights: NonNullable<RichText["highlights"]>): RichSegment[] {
  const ranges = highlights.map((highlight) => ({ start: highlight.start, end: highlight.start + highlight.length }));
  const pieces: RichSegment[] = [];
  let offset = 0;
  for (const segment of segments) {
    const start = offset;
    const end = offset + segment.text.length;
    offset = end;
    if (segment.emoji) {
      const index = ranges.findIndex((range) => start >= range.start && start < range.end);
      pieces.push(index >= 0 ? { ...segment, highlight: index } : segment);
      continue;
    }
    const edges = new Set([start, end]);
    for (const range of ranges) for (const edge of [range.start, range.end]) if (edge > start && edge < end) edges.add(edge);
    const points = [...edges].sort((a, b) => a - b);
    for (let index = 0; index < points.length - 1; index++) {
      const from = points[index]!;
      const to = points[index + 1]!;
      const piece: RichSegment = { ...segment, text: segment.text.slice(from - start, to - start) };
      const on = ranges.findIndex((range) => range.start <= from && range.end >= to);
      if (on >= 0) piece.highlight = on;
      pieces.push(piece);
    }
  }
  return pieces;
}

/** Cuts text and link pieces where a search's find starts or ends and marks the ones inside it; an emoji stays whole. */
export function markFound(segments: RichSegment[], ranges: readonly { start: number; end: number }[]): RichSegment[] {
  if (ranges.length === 0) return segments;
  const pieces: RichSegment[] = [];
  let offset = 0;
  for (const segment of segments) {
    const start = offset;
    const end = offset + segment.text.length;
    offset = end;
    if (segment.emoji || start === end) {
      pieces.push(segment);
      continue;
    }
    const edges = new Set([start, end]);
    for (const range of ranges) for (const edge of [range.start, range.end]) if (edge > start && edge < end) edges.add(edge);
    const points = [...edges].sort((a, b) => a - b);
    for (let index = 0; index < points.length - 1; index++) {
      const from = points[index]!;
      const to = points[index + 1]!;
      const piece: RichSegment = { ...segment, text: segment.text.slice(from - start, to - start) };
      if (ranges.some((range) => range.start <= from && range.end >= to)) piece.found = true;
      pieces.push(piece);
    }
  }
  return pieces;
}

/** The part of `rich` from `start` to `end`, with every run moved to match. */
export function sliceRich(rich: RichText, start: number, end: number): RichText {
  const within = <T extends { start: number; length: number }>(runs: T[] | undefined) =>
    (runs ?? [])
      .filter((run) => run.start >= start && run.start + run.length <= end)
      .map((run) => ({ ...run, start: run.start - start }));
  return {
    text: rich.text.slice(start, end),
    spans: within(rich.spans),
    emojis: within(rich.emojis),
    styles: within(rich.styles),
    highlights: within(rich.highlights),
  };
}

/** Cuts text and link pieces where a style run starts or ends; an emoji stays whole. */
function splitAtStyles(segments: RichSegment[], styles: RichStyle[]): RichSegment[] {
  const pieces: RichSegment[] = [];
  let offset = 0;
  for (const segment of segments) {
    const start = offset;
    const end = offset + segment.text.length;
    offset = end;
    if (segment.emoji) {
      pieces.push(segment);
      continue;
    }
    const edges = new Set([start, end]);
    for (const style of styles) {
      for (const edge of [style.start, style.start + style.length]) if (edge > start && edge < end) edges.add(edge);
    }
    const points = [...edges].sort((a, b) => a - b);
    for (let index = 0; index < points.length - 1; index++) {
      const from = points[index]!;
      const to = points[index + 1]!;
      const covering = styles.filter((style) => style.start <= from && style.start + style.length >= to);
      const piece: RichSegment = { ...segment, text: segment.text.slice(from - start, to - start) };
      if (covering.length) {
        piece.style = {
          bold: covering.some((style) => style.bold),
          italic: covering.some((style) => style.italic),
          strikethrough: covering.some((style) => style.strikethrough),
        };
      }
      pieces.push(piece);
    }
  }
  return pieces;
}
