import { useMemo } from "react";

import { getString } from "../../lib/i18n/index";
import { keyMapRows } from "../../lib/keyMap";
import { MUSIC_KEY_BINDINGS } from "../../lib/musicPlayerKeys";
import { VIDEO_KEY_BINDINGS } from "../../lib/videoPlayerKeys";

function KeyMap({ title, rows }: { title: string; rows: ReturnType<typeof keyMapRows> }) {
  return (
    <section className="min-w-0 space-y-2">
      <h3 className="text-sm font-semibold text-primary">{title}</h3>
      <dl className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <dt className="min-w-0 text-sm text-chrome-neutral-300">{row.label}</dt>
            <dd className="flex shrink-0 items-center gap-1">
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

/** Both players' keys, read from the same tables the players act on. */
export function KeyMapList() {
  const video = useMemo(() => keyMapRows(VIDEO_KEY_BINDINGS), []);
  const music = useMemo(() => keyMapRows(MUSIC_KEY_BINDINGS), []);
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <KeyMap title={getString("keyboard_shortcuts_video")} rows={video} />
      <KeyMap title={getString("keyboard_shortcuts_music")} rows={music} />
    </div>
  );
}
