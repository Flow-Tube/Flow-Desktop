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

/** Text with its links, custom emoji and bold, italic or struck-through stretches. Line breaks are kept. */
export function RichText({ value, onActivate, imageSrc, className }: RichTextProps) {
  return (
    <span dir="auto" className={`whitespace-pre-wrap break-words ${className ?? ""}`}>
      {richSegments(value).map((segment, index) => {
        if (segment.emoji) {
          return (
            <img
              key={index}
              src={imageSrc(segment.emoji.imageUrl)}
              alt={segment.emoji.label}
              title={segment.emoji.label}
              className="inline-block h-[1.2em] w-[1.2em] align-text-bottom"
            />
          );
        }
        if (segment.target) {
          const target = segment.target;
          return (
            <button
              key={index}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onActivate(target);
              }}
              className={`inline cursor-pointer break-all text-start font-medium text-primary hover:underline ${styleClass(segment.style)}`}
            >
              {segment.text}
            </button>
          );
        }
        const style = styleClass(segment.style);
        return style ? <span key={index} className={style}>{segment.text}</span> : <span key={index}>{segment.text}</span>;
      })}
    </span>
  );
}
