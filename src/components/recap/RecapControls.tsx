import type { RecapSource } from "../../lib/api/recap";
import { getString } from "../../lib/i18n/index";
import { ALL_TIME, scopeOf, shortMonthLabel, type PeriodScope } from "../../lib/recap/recapFormat";
import { Chip } from "../ui/Chip";
import { SegmentedControl } from "../ui/SegmentedControl";

interface RecapControlsProps {
  months: string[];
  period: string;
  source: RecapSource;
  onPeriod: (period: string) => void;
  onSource: (source: RecapSource) => void;
}

/** Month, year or all time, which one, and from what. */
export function RecapControls({ months, period, source, onPeriod, onSource }: RecapControlsProps) {
  const scope = scopeOf(period);
  const years = [...new Set(months.map((month) => month.slice(0, 4)))];
  const pickScope = (next: PeriodScope) => {
    if (next === "all") onPeriod(ALL_TIME);
    else if (next === "year") onPeriod(years[0] ?? ALL_TIME);
    else onPeriod(months[0] ?? ALL_TIME);
  };
  const choices = scope === "month" ? months : scope === "year" ? years : [];

  return (
    <div className="col-span-12 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          label={getString("recap_period_label")}
          value={scope}
          onChange={pickScope}
          options={[
            { value: "month", label: getString("recap_period_month") },
            { value: "year", label: getString("recap_period_year") },
            { value: "all", label: getString("recap_period_all") },
          ]}
        />
        <SegmentedControl
          label={getString("recap_source_label")}
          value={source}
          onChange={onSource}
          options={[
            { value: "ALL", label: getString("recap_source_all") },
            { value: "VIDEO", label: getString("recap_source_video") },
            { value: "MUSIC", label: getString("recap_source_music") },
          ]}
        />
      </div>
      {choices.length > 0 && (
        <div className="flex snap-x gap-2 overflow-x-auto pb-1">
          {choices.map((choice) => (
            <Chip
              key={choice}
              active={choice === period}
              onClick={() => onPeriod(choice)}
              className="shrink-0 snap-start focus-visible:ring-2 focus-visible:ring-primary"
            >
              {scope === "month" ? shortMonthLabel(choice) : choice}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
