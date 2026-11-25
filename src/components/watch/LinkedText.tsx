import { useMemo } from "react";
import { RichText } from "../ui/RichText";
import { linkifyPlain } from "../../lib/richText";
import { useProxyImageSrc } from "../../lib/useImageProxy";
import { useRichTargetHandler } from "../../lib/useRichTargetHandler";
import type { RichText as RichTextValue } from "../../types/video";

/** YouTube's own links for `text` when they belong to it, else the ones found in the text itself. */
function linkedValue(text: string, rich?: RichTextValue | null): RichTextValue {
  return rich && rich.text === text ? rich : linkifyPlain(text);
}

/** `text` with its links: YouTube's own when given, else the ones found in the text itself. */
export function LinkedText({ text, rich, className }: { text: string; rich?: RichTextValue | null; className?: string }) {
  const value = useMemo(() => linkedValue(text, rich), [rich, text]);
  return <RichValue value={value} className={className} />;
}

/** Rich text whose links open and whose emoji load the way the rest of the watch page does. */
export function RichValue({ value, className }: { value: RichTextValue; className?: string }) {
  const onActivate = useRichTargetHandler();
  const imageSrc = useProxyImageSrc();
  return <RichText value={value} onActivate={onActivate} imageSrc={imageSrc} className={className} />;
}
