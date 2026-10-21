import { Ban, Heart } from "lucide-react";
import { getString } from "../../../lib/i18n/index";
import { evidenceLabel } from "../../../lib/useTasteOverview";
import type { TasteGroup } from "../../../lib/api/recommendation";

interface TasteGroupsProps {
  groups: TasteGroup[];
  busy: boolean;
  onAdd: (label: string) => void;
  onBlock: (label: string) => void;
}

/** The interests learned from watching, in the groups the engine reads them in. */
export function TasteGroups({ groups, busy, onAdd, onBlock }: TasteGroupsProps) {
  if (groups.length === 0) {
    return <p className="text-sm text-chrome-neutral-500">{getString("taste_groups_empty")}</p>;
  }
  return (
    <ul className="space-y-4">
      {groups.map((group) => (
        <li key={group.id} className="space-y-2">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm font-medium text-chrome-neutral-200">{group.label}</span>
            <span className="shrink-0 text-xs text-chrome-neutral-500">
              {getString(evidenceLabel(group.evidence))}
            </span>
          </div>
          <div className="h-1 rounded-full bg-chrome-neutral-800">
            <div
              className="h-1 rounded-full bg-[var(--color-primary)]"
              style={{ width: `${Math.round(Math.min(1, Math.max(0, group.share)) * 100)}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {group.members.map((topic) => (
              <span
                key={topic.key}
                className="inline-flex items-center gap-1 rounded-full border border-chrome-neutral-700 py-1 pl-3 pr-1 text-sm text-chrome-neutral-300"
              >
                {topic.label}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAdd(topic.label)}
                  title={getString("taste_group_add", topic.label)}
                  aria-label={getString("taste_group_add", topic.label)}
                  className="grid h-6 w-6 place-items-center rounded-full transition-colors duration-200 ease-out hover:bg-chrome-neutral-800 disabled:cursor-wait disabled:opacity-60"
                >
                  <Heart size={13} />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onBlock(topic.label)}
                  title={getString("taste_group_block", topic.label)}
                  aria-label={getString("taste_group_block", topic.label)}
                  className="grid h-6 w-6 place-items-center rounded-full transition-colors duration-200 ease-out hover:bg-chrome-neutral-800 disabled:cursor-wait disabled:opacity-60"
                >
                  <Ban size={13} />
                </button>
              </span>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
