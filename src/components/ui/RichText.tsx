import { richSegments } from "../../lib/richText";
import type { RichTarget, RichText as RichTextValue } from "../../types/video";

export interface RichTextProps {
  value: RichTextValue;
  /** Called with the target of the link the user clicked. */
  onActivate: (target: RichTarget) => void;
  /** The source to load a custom emoji's picture from. */
  imageSrc: (url: string) => string;
  className?: string;
}

/** Text with its links and custom emoji. Line breaks in the text are kept. */
export function RichText({ value, onActivate, imageSrc, className }: RichTextProps) {
  return (
    <span className={`whitespace-pre-wrap break-words ${className ?? ""}`}>
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
              className="inline cursor-pointer break-all text-left font-medium text-primary hover:underline"
            >
              {segment.text}
            </button>
          );
        }
        return <span key={index}>{segment.text}</span>;
      })}
    </span>
  );
}
