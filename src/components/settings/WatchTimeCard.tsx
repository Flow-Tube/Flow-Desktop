import { useState } from "react";

import { APP_LOCALE, getString } from "../../lib/i18n/index";
import { localDate, spentTimeLabel } from "../../lib/recap/recapFormat";
import { useWatchTimeWeek, weekIsEstimated, weekTotals } from "../../lib/wellbeing/useWatchTimeWeek";
import { BarStrip } from "../recap/charts/BarStrip";
import { Button } from "../ui/Button";

function dayName(day: string, days: string[]): string {
  const index = days.indexOf(day);
  if (index === days.length - 1) return getString("time_today");
  if (index === days.length - 2) return getString("time_yesterday");
  return localDate(day).toLocaleDateString(APP_LOCALE, { weekday: "long" });
}

/**
 * The daily average over the last week, above one bar per day. Today's bar stands out. Choosing a
 * bar shows that day's time instead of the average, and choosing it again goes back.
 */
export function WatchTimeCard() {
  const { week, failed, retry } = useWatchTimeWeek();
  const [selected, setSelected] = useState<number | null>(null);

  if (failed) {
    return (
      <div className="flex items-center justify-between px-5 py-4">
        <span className="text-sm text-on-surface-variant">{getString("watch_time_failed")}</span>
        <Button variant="secondary" size="sm" onClick={retry}>{getString("retry")}</Button>
      </div>
    );
  }
  if (!week) {
    return <div className="h-64 animate-pulse" />;
  }

  const dates = week.days.map(([day]) => day);
  const values = week.days.map(([, ms]) => ms);
  const { total, dailyAverage, empty } = weekTotals(week.days);
  const chosen = selected !== null ? week.days[selected] : undefined;
  const names = dates.map((day) => localDate(day).toLocaleDateString(APP_LOCALE, { weekday: "short" }));

  return (
    <div className="flex flex-col gap-1 px-5 py-4">
      <div className="text-sm text-on-surface-variant">
        {chosen ? dayName(chosen[0], dates) : getString("daily_average_label")}
      </div>
      <div className="text-3xl font-bold tabular-nums tracking-tight text-on-surface">
        {spentTimeLabel(chosen ? chosen[1] : dailyAverage)}
      </div>
      <div className="mb-3 text-sm tabular-nums text-on-surface-variant">
        {getString("settings_watch_time_week_total", spentTimeLabel(total))}
      </div>
      {empty ? (
        <div className="flex h-32 items-center justify-center text-sm text-on-surface-variant">{getString("no_watch_data")}</div>
      ) : (
        <BarStrip
          values={values}
          labels={dates.map((day) => dayName(day, dates))}
          axis={names}
          highlight={selected ?? values.length - 1}
          format={spentTimeLabel}
          ariaLabel={dates.map((day, index) => `${dayName(day, dates)} ${spentTimeLabel(values[index] ?? 0)}`).join(", ")}
          onSelect={(index) => setSelected((current) => (current === index ? null : index))}
        />
      )}
      {weekIsEstimated(week) && <p className="text-xs text-on-surface-variant">{getString("stats_disclaimer")}</p>}
    </div>
  );
}
