import { Sparkles } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import type { AiSummary } from "../../types/video";

/**
 * YouTube's AI summary at the top of the description, said to be AI-written with YouTube's own
 * warning. Folded, it shows the first paragraph in three lines.
 */
export function DescriptionSummary({ summary, expanded }: { summary: AiSummary; expanded: boolean }) {
  const paragraphs = expanded ? summary.paragraphs : summary.paragraphs.slice(0, 1);
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-[var(--desc-raised)] p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-chrome-neutral-300">
        <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span dir="auto">{summary.title || getString("description_ai_summary")}</span>
      </div>
      {paragraphs.map((paragraph, index) => (
        <p key={index} dir="auto" className={`text-chrome-neutral-200 ${expanded ? "" : "line-clamp-3"}`}>
          {paragraph}
        </p>
      ))}
      <p dir="auto" className="text-xs text-chrome-neutral-400">
        {summary.disclaimer || getString("description_ai_summary_warning")}
      </p>
    </div>
  );
}
