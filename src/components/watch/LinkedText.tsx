import { useMemo } from "react";
import { RichText } from "../ui/RichText";
import { linkifyPlain } from "../../lib/richText";
import { useProxyImageSrc } from "../../lib/useImageProxy";
import { useRichTargetHandler } from "../../lib/useRichTargetHandler";
import type { RichText as RichTextValue } from "../../types/video";

/** `text` with its links: YouTube's own when given, else the ones found in the text itself. */
export function LinkedText({ text, rich, className }: { text: string; rich?: RichTextValue | null; className?: string }) {
  const onActivate = useRichTargetHandler();
  const imageSrc = useProxyImageSrc();
  const value = useMemo(() => (rich && rich.text === text ? rich : linkifyPlain(text)), [rich, text]);
  return <RichText value={value} onActivate={onActivate} imageSrc={imageSrc} className={className} />;
}
