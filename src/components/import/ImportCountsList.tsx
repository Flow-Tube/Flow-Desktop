import React from "react";
import { getString, type StringKey } from "../../lib/i18n/index";
import type { ImportCounts } from "../../lib/backup/importFile";

const ROWS: { key: Exclude<keyof ImportCounts, "neuro">; label: StringKey }[] = [
  { key: "subscriptions", label: "import_subscriptions" },
  { key: "playlists", label: "import_playlists" },
  { key: "history", label: "import_watch_history" },
  { key: "likes", label: "import_likes" },
  { key: "settings", label: "import_settings" },
];

/** What an import brought in, one row per kind with anything in it. */
export const ImportCountsList: React.FC<{ counts: ImportCounts }> = ({ counts }) => (
  <div className="mx-auto max-w-xs space-y-1 text-xs text-chrome-neutral-400">
    {ROWS.filter((row) => counts[row.key] > 0).map((row) => (
      <div key={row.key} className="flex justify-between rounded-lg bg-surface-container-high px-3 py-2">
        <span>{getString(row.label)}</span>
        <span className="font-mono tabular-nums text-chrome-neutral-200">{counts[row.key]}</span>
      </div>
    ))}
    {counts.neuro && (
      <div className="flex justify-between rounded-lg bg-surface-container-high px-3 py-2">
        <span>{getString("import_neuro_profile")}</span>
        <span className="font-mono text-chrome-neutral-200">{getString("ok")}</span>
      </div>
    )}
  </div>
);
