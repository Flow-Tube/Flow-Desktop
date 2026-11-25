import type { RichText } from "../types/video";
import { sliceRich } from "./richText";

/** A description cut into runs of text and the video cards YouTube shows between them. */
export type DescriptionBlock =
  | { kind: "text"; text: RichText }
  | { kind: "video"; videoId: string; startSeconds: number | null; title: string };

/**
 * The server prints a video link as `•` and the title cut short with `...`, padded with
 * non-breaking spaces; the card cuts the title itself.
 */
export function videoCardTitle(linkText: string): string {
  return linkText
    .trim()
    .replace(/^•/, "")
    .trim()
    .replace(/(\.\.\.|…)$/, "")
    .trim()
    .replace(/ /g, " ");
}

/**
 * Lifts every link to another video that ends its line out into a card, as YouTube's app and
 * Flow for Android do; whatever precedes it on the line stays text above the card. A link with
 * more text after it on its line is part of a sentence and stays inline, and a link back to
 * `ownVideoId` is a moment of this video, never a card. A description with no such link comes
 * back as one block.
 */
export function descriptionBlocks(rich: RichText, ownVideoId: string | null): DescriptionBlock[] {
  const blocks: DescriptionBlock[] = [];
  const { text } = rich;
  let cursor = 0;
  const addText = (from: number, to: number) => {
    let start = from;
    let end = to;
    while (start < end && /\s/.test(text[start]!)) start++;
    while (end > start && /\s/.test(text[end - 1]!)) end--;
    if (start < end) blocks.push({ kind: "text", text: sliceRich(rich, start, end) });
  };

  for (const span of [...rich.spans].sort((a, b) => a.start - b.start)) {
    const target = span.target;
    if (target.kind !== "video" || target.videoId === ownVideoId || span.start < cursor) continue;
    const spanEnd = span.start + span.length;
    const newline = text.indexOf("\n", spanEnd);
    const lineEnd = newline < 0 ? text.length : newline;
    if (text.slice(spanEnd, lineEnd).trim()) continue;
    const title = videoCardTitle(text.slice(span.start, spanEnd));
    if (!title) continue;
    addText(cursor, span.start);
    blocks.push({ kind: "video", videoId: target.videoId, startSeconds: target.startSeconds ?? null, title });
    cursor = Math.min(lineEnd + 1, text.length);
  }
  if (blocks.length === 0) return [{ kind: "text", text: rich }];
  addText(cursor, text.length);
  return blocks;
}
