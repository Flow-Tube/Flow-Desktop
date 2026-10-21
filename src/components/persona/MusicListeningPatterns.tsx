import { getString } from "../../lib/i18n/index";
import type { MusicTasteProfile } from "../../types/music";
import { timeBucketLabel } from "./TimePatterns";

interface MusicListeningPatternsProps {
  profile: MusicTasteProfile;
}

// Mirrors `TimePatterns`' client-side bucket derivation so the current slot is highlighted.
function currentBucket(): string {
  const date = new Date();
  const day = date.getDay();
  const hour = date.getHours();
  const isWeekend = day === 0 || day === 6;
  const period =
    hour >= 6 && hour < 12
      ? "Morning"
      : hour >= 12 && hour < 18
        ? "Afternoon"
        : hour >= 18 && hour < 24
          ? "Evening"
          : "Night";
  return `${isWeekend ? "Weekend" : "Weekday"}${period}`;
}

export function MusicListeningPatterns({ profile }: MusicListeningPatternsProps) {
  const buckets = profile.timeOfDay;
  const max = buckets.reduce((m, b) => Math.max(m, b.plays), 0);
  const active = currentBucket();

  return (
    <section className="w-full rounded-2xl border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-low)] p-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold text-[var(--color-on-surface)]">
          {getString("music_listening_patterns")}
        </h3>
        <p className="text-sm text-[var(--color-on-surface-variant)]">
          {getString("music_total_plays")}
        </p>
      </div>

      {max <= 0 ? (
        <div className="mt-6 flex h-24 items-center justify-center rounded-xl border border-dashed border-[var(--color-outline-variant)] bg-[var(--color-surface-container)]">
          <span className="text-sm text-[var(--color-on-surface-variant)]">
            {getString("music_no_patterns_yet")}
          </span>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
          {buckets.map((bucket) => {
            const isActive = bucket.bucket === active;
            const widthPct = max > 0 ? (bucket.plays / max) * 100 : 0;
            const topGenre = bucket.topGenres[0]?.genre;
            return (
              <div key={bucket.bucket} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span
                    className={`truncate ${isActive ? "font-semibold text-[var(--color-primary)]" : "text-[var(--color-on-surface)]"}`}
                  >
                    {timeBucketLabel(bucket.bucket)}
                    {topGenre ? (
                      <span className="ml-2 text-[var(--color-on-surface-variant)]">· {topGenre}</span>
                    ) : null}
                  </span>
                  <span className="font-mono text-[var(--color-on-surface-variant)]">{bucket.plays}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-outline-variant)]">
                  <div
                    className="h-full rounded-full bg-[var(--color-primary)]"
                    style={{ width: `${widthPct}%`, opacity: isActive ? 1 : 0.6 }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
