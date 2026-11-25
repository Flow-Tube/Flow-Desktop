import { useNavigate } from "react-router-dom";
import { getString } from "../../lib/i18n/index";

/** The video's category and the uploader's tags, in a stable order; each one searches. */
export function descriptionTags(tags: string[] | undefined, category: string | null | undefined): string[] {
  const sorted = [...new Set(tags ?? [])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return category && !sorted.includes(category) ? [category, ...sorted] : sorted;
}

export function DescriptionTags({ tags, category }: { tags?: string[]; category?: string | null }) {
  const navigate = useNavigate();
  const shown = descriptionTags(tags, category);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-chrome-neutral-400">{getString("watch_tags")}</p>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              navigate(`/search?q=${encodeURIComponent(tag)}`);
            }}
            className="rounded-full bg-[var(--desc-raised,var(--color-surface-container-high))] px-3 py-1.5 text-xs font-medium text-chrome-neutral-300 transition-opacity duration-200 ease-out hover:opacity-80"
          >
            {tag}
          </button>
        ))}
      </div>
    </div>
  );
}
