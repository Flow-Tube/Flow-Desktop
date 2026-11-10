import { getString } from "../../lib/i18n/index";
import type { MusicTasteProfile } from "../../types/music";

interface MusicGenreAffinityProps {
  profile: MusicTasteProfile;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function MusicGenreAffinity({ profile }: MusicGenreAffinityProps) {
  const genres = profile.topGenres;
  const segment = genres.slice(0, 6);
  const totalWeight = segment.reduce((acc, g) => acc + g.weight, 0);

  return (
    <section className="flex h-full w-full flex-col rounded-2xl border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-low)] p-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold text-[var(--color-on-surface)]">
          {getString("music_genre_affinity")}
        </h3>
        <p className="text-sm text-[var(--color-on-surface-variant)]">
          {getString("music_taste_title")}
        </p>
      </div>

      {totalWeight <= 0 ? (
        <div className="mt-6 flex h-24 flex-1 items-center justify-center rounded-xl border border-dashed border-[var(--color-outline-variant)] bg-[var(--color-surface-container)]">
          <span className="text-sm text-[var(--color-on-surface-variant)]">
            {getString("music_no_genres_yet")}
          </span>
        </div>
      ) : (
        <div className="mt-6">
          <div className="flex h-5 w-full overflow-hidden rounded-full bg-[var(--color-outline-variant)]">
            {segment.map((g, index) => (
              <div
                key={g.genre}
                className="h-full bg-[var(--color-primary)]"
                style={{ width: `${(g.weight / totalWeight) * 100}%`, opacity: 0.95 - index * 0.12 }}
                title={`${g.genre}: ${formatPercent(g.weight)}`}
              />
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            {genres.map((g, index) => (
              <div key={g.genre} className="flex min-w-0 items-center gap-2 text-xs">
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]"
                  style={{ opacity: 0.95 - index * 0.1 }}
                />
                <span className="truncate text-[var(--color-on-surface)]">{g.genre}</span>
                <span className="ms-auto font-mono text-[var(--color-on-surface-variant)]">
                  {formatPercent(g.weight)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
