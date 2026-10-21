import { Ban, Music2, Trash2 } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import { useMusicActionsStore } from "../../store/useMusicActionsStore";

/**
 * Management list for the music block list: every hard-blocked artist with one-click
 * unblock. The twin of {@link BlockedContent} for the music engine. Renders nothing (and
 * occupies no grid cell) when there is nothing blocked.
 */
export function MusicBlockedArtists() {
  const blockedArtists = useMusicActionsStore((s) => s.blockedArtists);
  const unblockArtist = useMusicActionsStore((s) => s.unblockArtist);
  const entries = [...blockedArtists.entries()];

  if (entries.length === 0) return null;

  return (
    <div className="col-span-12 lg:col-span-6">
      <section className="flex h-full w-full flex-col rounded-2xl border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-low)] p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Ban className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-on-surface-variant)]" />
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-[var(--color-on-surface)]">
                {getString("music_blocked_artists")}
              </h3>
              <p className="text-sm text-[var(--color-on-surface-variant)]">
                {getString("music_blocked_artists_desc")}
              </p>
            </div>
          </div>

          <div className="text-right">
            <p className="font-mono text-xl text-[var(--color-on-surface)]">{entries.length}</p>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
              {getString("music_role_artist")}
            </p>
          </div>
        </div>

        <div className="mt-6 max-h-72 overflow-y-auto rounded-xl border border-[var(--color-outline-variant)]">
          <table className="w-full border-collapse text-sm">
            <tbody className="divide-y divide-[var(--color-outline-variant)]">
              {entries.map(([key, name]) => (
                <tr key={key}>
                  <td className="w-10 px-4 py-3 text-[var(--color-on-surface-variant)]">
                    <Music2 className="h-4 w-4" />
                  </td>
                  <td className="px-0 py-3 text-[var(--color-on-surface)]">
                    <span className="block truncate">{name}</span>
                  </td>
                  <td className="w-12 px-4 py-3 text-right">
                    <button
                      onClick={() => void unblockArtist(key)}
                      title={getString("persona_unblock_item", name)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-on-surface-variant)] transition-colors hover:bg-chrome-red-950/30 hover:text-chrome-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
