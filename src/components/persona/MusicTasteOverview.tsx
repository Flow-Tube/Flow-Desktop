import { Compass, ListMusic, Repeat, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import type { MusicMaturity, MusicTasteProfile } from "../../types/music";

interface MusicTasteOverviewProps {
  profile: MusicTasteProfile;
}

const MATURITY_LABEL: Record<MusicMaturity, string> = {
  cold_start: "music_maturity_cold_start",
  warming: "music_maturity_warming",
  mature: "music_maturity_mature",
};

interface Cell {
  label: string;
  value: number;
  icon: LucideIcon;
}

export function MusicTasteOverview({ profile }: MusicTasteOverviewProps) {
  const appetitePct = Math.round(profile.discoveryAppetite * 100);
  const maturityKey = (MATURITY_LABEL[profile.maturity] ?? MATURITY_LABEL.cold_start) as Parameters<
    typeof getString
  >[0];

  const cells: Cell[] = [
    { label: getString("music_total_plays"), value: profile.totalPlays, icon: ListMusic },
    { label: getString("music_distinct_artists"), value: profile.distinctArtists, icon: Users },
    { label: getString("music_tracked_tracks"), value: profile.trackedTracks, icon: ListMusic },
    { label: getString("music_on_repeat_count"), value: profile.onRepeatCount, icon: Repeat },
  ];

  return (
    <section className="flex h-full w-full flex-col rounded-2xl border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-low)] p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-semibold text-[var(--color-on-surface)]">
            {getString("music_taste_title")}
          </h3>
          <p className="text-sm text-[var(--color-on-surface-variant)]">
            {getString("music_taste_desc")}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-[var(--color-outline-variant)] bg-[var(--color-surface-container)] px-3 py-1 text-xs font-semibold text-[var(--color-on-surface)]">
          {getString(maturityKey)}
        </span>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {cells.map((cell, index) => {
          const Icon = cell.icon;
          return (
            <div
              key={`${cell.label}-${index}`}
              className="relative min-h-24 rounded-xl border border-[var(--color-outline-variant)] bg-[var(--color-surface-container)] p-4"
            >
              <Icon className="absolute right-3 top-3 h-4 w-4 text-[var(--color-on-surface-variant)] opacity-70" />
              <p className="pe-6 text-xs font-semibold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
                {cell.label}
              </p>
              <p className="mt-4 font-mono text-2xl leading-none text-[var(--color-on-surface)]">
                {cell.value.toLocaleString()}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between gap-4">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
            <Compass className="h-3.5 w-3.5" />
            {getString("music_discovery_appetite")}
          </p>
          <p className="font-mono text-xs text-[var(--color-on-surface)]">{appetitePct}%</p>
        </div>
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-outline-variant)]">
          <div
            className="h-full rounded-full bg-[var(--color-primary)]"
            style={{ width: `${appetitePct}%` }}
          />
        </div>
      </div>
    </section>
  );
}
