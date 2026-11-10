import { Heart } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { getString } from "../../lib/i18n/index";
import type { MusicTasteProfile } from "../../types/music";

interface MusicTopArtistsProps {
  profile: MusicTasteProfile;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function MusicTopArtists({ profile }: MusicTopArtistsProps) {
  const navigate = useNavigate();
  const artists = profile.topArtists;

  return (
    <section className="flex h-full w-full flex-col rounded-2xl border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-low)] p-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold text-[var(--color-on-surface)]">
          {getString("music_top_artists")}
        </h3>
        <p className="text-sm text-[var(--color-on-surface-variant)]">
          {getString("music_role_artist")} · {getString("music_affinity")}
        </p>
      </div>

      {artists.length === 0 ? (
        <div className="mt-6 flex h-24 items-center justify-center rounded-xl border border-dashed border-[var(--color-outline-variant)] bg-[var(--color-surface-container)]">
          <span className="text-sm text-[var(--color-on-surface-variant)]">
            {getString("music_no_artists_yet")}
          </span>
        </div>
      ) : (
        <div className="mt-6 max-h-[480px] overflow-y-auto rounded-xl border border-[var(--color-outline-variant)]">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-[var(--color-surface-container-high)]">
              <tr className="border-b border-[var(--color-outline-variant)]">
                <th className="px-4 py-3 text-start text-xs font-semibold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
                  {getString("music_role_artist")}
                </th>
                <th className="px-4 py-3 text-end text-xs font-semibold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
                  {getString("music_affinity")}
                </th>
                <th className="px-4 py-3 text-end text-xs font-semibold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
                  {getString("music_plays")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-outline-variant)]">
              {artists.map((artist) => {
                const clickable = artist.idKeyed;
                return (
                  <tr
                    key={artist.key}
                    onClick={clickable ? () => navigate(`/music/artist/${artist.key}`) : undefined}
                    className={`bg-[var(--color-surface-container-low)] transition-colors duration-200 ease-out ${
                      clickable
                        ? "cursor-pointer hover:bg-[var(--color-surface-container)]"
                        : ""
                    }`}
                  >
                    <td className="px-4 py-3 text-[var(--color-on-surface)]">
                      <div className="flex min-w-0 items-center gap-2">
                        <span dir="auto" className="truncate font-medium">{artist.name}</span>
                        {artist.liked && (
                          <Heart
                            className="h-3.5 w-3.5 shrink-0 text-[var(--color-primary)]"
                            fill="currentColor"
                            aria-label={getString("music_liked")}
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-end font-mono text-[var(--color-on-surface)]">
                      {formatPercent(artist.score)}
                    </td>
                    <td className="px-4 py-3 text-end font-mono text-[var(--color-on-surface)]">
                      {artist.plays}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
