import type { ReactNode } from "react";

import { richSegments, type RichSegment } from "../../lib/richText";
import type { RichTarget, RichText as RichTextValue } from "../../types/video";

export interface RichTextProps {
  value: RichTextValue;
  /** Called with the target of the link the user clicked. */
  onActivate: (target: RichTarget) => void;
  /** The source to load a custom emoji's picture from. */
  imageSrc: (url: string) => string;
  className?: string;
}

function styleClass(style: RichSegment["style"]): string {
  if (!style) return "";
  return [style.bold && "font-semibold", style.italic && "italic", style.strikethrough && "line-through"]
    .filter(Boolean)
    .join(" ");
}

/**
 * How Flow for Android sets each kind of link: a moment or a hashtag in bold, a channel in
 * medium, and a web or video link underlined, unless it sits on a chip that marks it already.
 * `--rich-link` lets a surface pick its own link colour; the theme's primary otherwise.
 */
function linkClass(target: RichTarget, onChip: boolean): string {
  const weight = target.kind === "timestamp" || target.kind === "hashtag" ? "font-bold" : "font-medium";
  const underline = target.kind === "timestamp" || target.kind === "hashtag" || target.kind === "channel" || onChip
    ? "hover:underline"
    : "underline decoration-1 underline-offset-2";
  return `${weight} ${underline} ${target.kind === "url" ? "break-all" : ""}`;
}

function Piece({ segment, onActivate, imageSrc }: { segment: RichSegment; onActivate: RichTextProps["onActivate"]; imageSrc: RichTextProps["imageSrc"] }) {
  if (segment.emoji) {
    // An icon inserted before a link sits in a one-em box; a custom emoji is drawn a little larger.
    const inserted = segment.emoji.length === 0;
    return (
      <img
        src={imageSrc(segment.emoji.imageUrl)}
        alt={segment.emoji.label}
        title={segment.emoji.label || undefined}
        className={inserted
          ? "mx-[0.15em] inline-block h-[1em] w-[1em] object-contain align-[-0.125em]"
          : "inline-block h-[1.2em] w-[1.2em] align-text-bottom"}
      />
    );
  }
  if (segment.target) {
    const target = segment.target;
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onActivate(target);
        }}
        className={`inline cursor-pointer rounded-sm text-start text-[var(--rich-link,var(--color-primary))] focus-visible:bg-primary/10 focus-visible:outline-none active:bg-primary/10 ${linkClass(target, segment.highlight !== undefined)} ${styleClass(segment.style)}`}
      >
        {segment.text}
      </button>
    );
  }
  const style = styleClass(segment.style);
  return style ? <span className={style}>{segment.text}</span> : <>{segment.text}</>;
}

/**
 * Text with its links, custom emoji, inserted link icons, chips and bold, italic or struck-through
 * stretches. Line breaks are kept.
 */
export function RichText({ value, onActivate, imageSrc, className }: RichTextProps) {
  const segments = richSegments(value);
  const out: ReactNode[] = [];
  for (let index = 0; index < segments.length; ) {
    const segment = segments[index]!;
    if (segment.highlight === undefined) {
      out.push(<Piece key={index} segment={segment} onActivate={onActivate} imageSrc={imageSrc} />);
      index += 1;
      continue;
    }
    const chip: RichSegment[] = [];
    while (index < segments.length && segments[index]!.highlight === segment.highlight) chip.push(segments[index++]!);
    const text = chip.map((piece) => piece.text).join("");
    // The rounded tint YouTube draws behind a channel or site link, cloned onto every line it
    // wraps to. The server pads some chips with its own spaces; padding those again draws them a
    // space too wide.
    out.push(
      <span
        key={`chip-${index}`}
        className={`rounded-full bg-on-surface/10 py-px [-webkit-box-decoration-break:clone] [box-decoration-break:clone] ${/^\s/.test(text) ? "" : "ps-[5px]"} ${/\s$/.test(text) ? "" : "pe-[5px]"}`}
      >
        {chip.map((piece, at) => (
          <Piece key={at} segment={piece} onActivate={onActivate} imageSrc={imageSrc} />
        ))}
      </span>,
    );
  }
  return (
    <span dir="auto" className={`whitespace-pre-wrap break-words ${className ?? ""}`}>
      {out}
    </span>
  );
}
