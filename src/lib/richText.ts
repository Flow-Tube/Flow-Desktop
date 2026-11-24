import type { RichEmoji, RichStyle, RichTarget, RichText } from "../types/video";

export interface RichSegment {
  text: string;
  target?: RichTarget;
  emoji?: RichEmoji;
  /** Bold, italic or struck through, when a style run covers the piece. */
  style?: Pick<RichStyle, "bold" | "italic" | "strikethrough">;
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

/** `rich` cut into plain, linked and emoji pieces, in order. A run overlapping an earlier one is dropped. */
export function richSegments(rich: RichText): RichSegment[] {
  const marks = [
    ...rich.spans.map((span) => ({ start: span.start, end: span.start + span.length, target: span.target })),
    ...rich.emojis.map((emoji) => ({ start: emoji.start, end: emoji.start + emoji.length, emoji })),
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
  return rich.styles?.length ? splitAtStyles(segments, rich.styles) : segments;
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
