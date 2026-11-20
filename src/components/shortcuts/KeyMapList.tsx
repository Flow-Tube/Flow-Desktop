import { useMemo } from "react";

import { getString } from "../../lib/i18n/index";
import { IS_MACOS_RUNTIME } from "../../lib/platform";
import { useShortcutSettings } from "../../lib/shortcuts/bindings";
import { SHORTCUT_GROUPS } from "../../lib/shortcuts/catalog";
import { shortcutRows, type ShortcutRow } from "../../lib/shortcuts/format";

function KeyMap({ title, rows }: { title: string; rows: ShortcutRow[] }) {
  return (
    <section className="min-w-0 space-y-2">
      <h3 className="text-sm font-semibold text-primary">{title}</h3>
      <dl className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center justify-between gap-3">
            <dt className="min-w-0 text-sm text-chrome-neutral-300">{row.label}</dt>
            {/* Key caps read left to right in every language, as they are printed on the keys. */}
            <dd dir="ltr" className="flex shrink-0 flex-wrap items-center justify-end gap-1">
              {row.caps.map((cap) => (
                <kbd
                  key={cap}
                  className="rounded-md border border-chrome-neutral-800 bg-surface-container-high px-1.5 py-0.5 font-sans text-xs tabular-nums text-chrome-neutral-200"
                >
                  {cap}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Every key in the app, read from the same tables the app acts on. */
export function KeyMapList() {
  const { overrides } = useShortcutSettings();
  const groups = useMemo(
    () =>
      SHORTCUT_GROUPS.map((group) => ({
        scope: group.scope,
        title: getString(group.title),
        // A command someone left without keys has nothing to show here.
        rows: shortcutRows(group.commands, IS_MACOS_RUNTIME, overrides).filter((row) => row.caps.length > 0),
      })),
    [overrides],
  );
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {groups.map((group) => (
        <KeyMap key={group.scope} title={group.title} rows={group.rows} />
      ))}
    </div>
  );
}
