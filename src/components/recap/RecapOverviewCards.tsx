import type { ReactNode } from "react";

import type { ActivityPattern, RecapSource, RecapSummary } from "../../lib/api/recap";
import { APP_LOCALE, getPlural, getString } from "../../lib/i18n/index";
import {
  dayLabel,
  deltaLabel,
  INSIGHT_LABELS,
  scopeOf,
  spentTimeLabel,
  timeSeries,
} from "../../lib/recap/recapFormat";
import { BarStrip } from "./charts/BarStrip";
import { CalendarChart } from "./charts/CalendarChart";
import { ClockChart } from "./charts/ClockChart";
import { Figure, RecapCard } from "./RecapCard";

const peakIndex = (values: number[]): number | null => {
  const peak = Math.max(...values, 0);
  return peak > 0 ? values.indexOf(peak) : null;
};

/** The headline: total time against the period before, and the counts behind it. */
export function OverviewCard({
  summary,
  activity,
  source,
  action,
}: {
  summary: RecapSummary;
  activity: ActivityPattern;
  source: RecapSource;
  action?: ReactNode;
}) {
  return (
    <RecapCard span="col-span-12" title={getString("recap_total_time")}>
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <Figure emphasized value={spentTimeLabel(activity.totalMs)} label={deltaLabel(activity.totalMs, summary.previousTotalMs)} />
        <div className="flex flex-wrap gap-x-10 gap-y-3">
          {source !== "MUSIC" && <Figure value={String(summary.video.views)} label={getString("recap_views")} />}
          {source !== "VIDEO" && <Figure value={String(summary.music.plays)} label={getString("recap_plays")} />}
          <Figure value={String(activity.activeDays)} label={getString("recap_active_days")} />
          <Figure value={getPlural("recap_days", activity.longestStreak)} label={getString("recap_streak")} />
        </div>
        {action}
      </div>
    </RecapCard>
  );
}

export function InsightsCard({ summary }: { summary: RecapSummary }) {
  return (
    <RecapCard span="col-span-12 lg:col-span-4" title={getString("recap_insights_title")}>
      <ul className="flex flex-col gap-3">
        {summary.insights.map((insight) => {
          const [title, body] = INSIGHT_LABELS[insight];
          return (
            <li key={insight}>
              <div className="text-sm font-semibold text-primary">{getString(title)}</div>
              <div className="text-sm text-on-surface-variant">{getString(body)}</div>
            </li>
          );
        })}
      </ul>
    </RecapCard>
  );
}

export function TimeCard({ period, activity, span }: { period: string; activity: ActivityPattern; span: string }) {
  const series = timeSeries(period, activity);
  const minutes = (value: number) => spentTimeLabel(value * 60_000);
  const busiest = activity.busiestDay;
  return (
    <RecapCard span={span} title={getString(scopeOf(period) === "month" ? "recap_daily_title" : "recap_monthly_title")}>
      <BarStrip
        values={series.values}
        labels={series.labels}
        axis={series.axis}
        highlight={peakIndex(series.values)}
        format={minutes}
        caption={busiest ? getString("recap_busiest_day", dayLabel(busiest[0]), spentTimeLabel(busiest[1])) : undefined}
        ariaLabel={series.labels.map((label, index) => `${label} ${minutes(series.values[index] ?? 0)}`).join(", ")}
      />
    </RecapCard>
  );
}

export function ClockCard({ activity }: { activity: ActivityPattern }) {
  return (
    <RecapCard span="col-span-12 md:col-span-6 lg:col-span-4" title={getString("recap_clock_title")} subtitle={getString("recap_clock_subtitle")}>
      <ClockChart
        hourCounts={activity.hourCounts}
        ariaLabel={activity.hourCounts.map((count, hour) => `${hour}:00 ${count}`).join(", ")}
      />
    </RecapCard>
  );
}

export function CalendarCard({ month, activity }: { month: string; activity: ActivityPattern }) {
  const active = Object.entries(activity.dayMs).filter(([day, ms]) => ms > 0 && day.startsWith(month)).length;
  const label = getPlural("recap_days", active);
  return (
    <RecapCard span="col-span-12 md:col-span-6 lg:col-span-4" title={getString("recap_calendar_title")} subtitle={label}>
      <CalendarChart month={month} dayMs={activity.dayMs} ariaLabel={label} />
    </RecapCard>
  );
}

export function WeekdayCard({ activity }: { activity: ActivityPattern }) {
  const names = activity.weekdayCounts.map((_, index) =>
    new Date(2026, 5, 1 + index).toLocaleDateString(APP_LOCALE, { weekday: "short" }),
  );
  return (
    <RecapCard span="col-span-12 md:col-span-6 lg:col-span-4" title={getString("recap_weekdays_title")}>
      <BarStrip
        values={activity.weekdayCounts}
        labels={names}
        axis={names}
        highlight={peakIndex(activity.weekdayCounts)}
        format={String}
        ariaLabel={names.map((name, index) => `${name} ${activity.weekdayCounts[index]}`).join(", ")}
      />
    </RecapCard>
  );
}
