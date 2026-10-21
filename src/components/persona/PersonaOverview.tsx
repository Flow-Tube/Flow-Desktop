import type { UserBrain, PersonaDetails } from "../../lib/api/recommendation";
import { getString } from "../../lib/i18n/index";

interface PersonaOverviewProps {
  brain: UserBrain;
  persona: PersonaDetails | null;
}

export function PersonaOverview({ brain, persona }: PersonaOverviewProps) {
  const total = brain.total_interactions || 0;
  const target = 250;
  const maturityPercent = Math.min(100, Math.round((total / target) * 100));
  const maturityLabel = getString(
    total >= target
      ? "persona_maturity_mature"
      : total >= 50
        ? "persona_maturity_maturing"
        : total >= 15
          ? "persona_maturity_early"
          : "persona_maturity_new",
  );
  const maturityTitle = persona?.title ?? getString("persona_default_title");
  const maturitySubtitle = persona?.description ?? getString("persona_default_subtitle");

  return (
    <section className="w-full rounded-2xl bg-[var(--color-surface-container-low)] border border-[var(--color-outline-variant)] p-6">
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
            {getString("persona_overview_label")}
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--color-on-surface)]">
            {maturityTitle}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-on-surface-variant)]">
            {maturitySubtitle}
          </p>
        </div>

        <div className="w-full md:max-w-md">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-xs font-semibold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
              {getString("persona_neuro_maturity")}
            </span>
            <span className="font-mono text-sm text-[var(--color-on-surface)]">
              {maturityLabel} / {maturityPercent}% / {total}/{target}
            </span>
          </div>
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[var(--color-outline-variant)]">
            <div
              className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-500"
              style={{ width: `${maturityPercent}%` }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
