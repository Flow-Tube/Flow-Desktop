import type { ActivityPattern, RecapInsight, RecapSummary } from "../api/recap";
import { APP_LOCALE, getPlural, getString, type StringKey } from "../i18n/index";

const MINUTE_MS = 60_000;
const SAME_SHARE = 0.05;
const RECENT_MONTHS = 12;

export const ALL_TIME = "all";

/** "2 h 5 min", or minutes alone under an hour. */
export function spentTimeLabel(ms: number): string {
  const total = Math.floor(ms / MINUTE_MS);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours > 0 ? getString("recap_duration_hours_minutes", hours, minutes) : getPlural("recap_duration_minutes", minutes);
}

export type PeriodScope = "month" | "year" | "all";

export function scopeOf(period: string): PeriodScope {
  if (period === ALL_TIME) return "all";
  return period.includes("-") ? "month" : "year";
}

function monthDate(month: string): Date {
  const [year, number] = month.split("-").map(Number);
  return new Date(year!, (number ?? 1) - 1, 1);
}

/** A local date from "2026-09-14": parsing it directly would read it as UTC. */
export function localDate(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year!, (month ?? 1) - 1, date ?? 1);
}

export function shortMonthLabel(month: string): string {
  return monthDate(month).toLocaleDateString(APP_LOCALE, { month: "short", year: "numeric" });
}

export function periodLabel(period: string): string {
  const scope = scopeOf(period);
  if (scope === "all") return getString("recap_period_all");
  if (scope === "year") return period;
  return monthDate(period).toLocaleDateString(APP_LOCALE, { month: "long", year: "numeric" });
}

export function dayLabel(day: string): string {
  return localDate(day).toLocaleDateString(APP_LOCALE, { month: "short", day: "numeric", year: "numeric" });
}

export function dateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(APP_LOCALE, { month: "short", day: "numeric", year: "numeric" });
}

export function hourLabel(hour: number): string {
  return new Date(2026, 0, 1, hour).toLocaleTimeString(APP_LOCALE, { hour: "numeric" });
}

export function deltaLabel(totalMs: number, previousMs: number | null): string {
  if (previousMs === null || previousMs <= 0) return getString("recap_total_time");
  const difference = totalMs - previousMs;
  if (Math.abs(difference) <= previousMs * SAME_SHARE) return getString("recap_delta_same");
  return difference > 0
    ? getString("recap_delta_up", spentTimeLabel(difference))
    : getString("recap_delta_down", spentTimeLabel(-difference));
}

export const INSIGHT_LABELS: Record<RecapInsight, [title: StringKey, body: StringKey]> = {
  NIGHT_OWL: ["recap_insight_night_owl", "recap_insight_night_owl_body"],
  EARLY_BIRD: ["recap_insight_early_bird", "recap_insight_early_bird_body"],
  WEEKEND_WATCHER: ["recap_insight_weekend", "recap_insight_weekend_body"],
  LOYAL: ["recap_insight_loyal", "recap_insight_loyal_body"],
  EXPLORER: ["recap_insight_explorer", "recap_insight_explorer_body"],
  MARATHON: ["recap_insight_marathon", "recap_insight_marathon_body"],
  TIME_SAVER: ["recap_insight_time_saver", "recap_insight_time_saver_body"],
};

export interface TimeSeries {
  /** Minutes per slot. */
  values: number[];
  /** What each slot is, for reading one out. */
  labels: string[];
  /** Text under the slots; a slot with an empty string has none. */
  axis: string[];
}

function daysInMonth(month: string): number {
  const [year, number] = month.split("-").map(Number);
  return new Date(year!, number!, 0).getDate();
}

/** Minutes per day for a month; per month for a year or for all time. */
export function timeSeries(period: string, activity: ActivityPattern): TimeSeries {
  if (scopeOf(period) === "month") {
    const count = daysInMonth(period);
    const days = Array.from({ length: count }, (_, index) => index + 1);
    const middle = Math.ceil(count / 2);
    return {
      values: days.map((day) => (activity.dayMs[`${period}-${String(day).padStart(2, "0")}`] ?? 0) / MINUTE_MS),
      labels: days.map((day) => dayLabel(`${period}-${String(day).padStart(2, "0")}`)),
      axis: days.map((day) => (day === 1 || day === middle || day === count ? String(day) : "")),
    };
  }
  const months = scopeOf(period) === "year" ? yearMonths(period) : recentMonths(activity);
  const totals = new Map<string, number>();
  for (const [day, ms] of Object.entries(activity.dayMs)) {
    const month = day.slice(0, 7);
    totals.set(month, (totals.get(month) ?? 0) + ms);
  }
  return {
    values: months.map((month) => (totals.get(month) ?? 0) / MINUTE_MS),
    labels: months.map(shortMonthLabel),
    axis: months.map((month) => monthDate(month).toLocaleDateString(APP_LOCALE, { month: "narrow" })),
  };
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function yearMonths(year: string): string[] {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
}

function recentMonths(activity: ActivityPattern): string[] {
  const days = Object.keys(activity.dayMs).sort();
  const last = days.length > 0 ? monthDate(days[days.length - 1]!.slice(0, 7)) : new Date();
  return Array.from({ length: RECENT_MONTHS }, (_, index) =>
    monthKey(new Date(last.getFullYear(), last.getMonth() - (RECENT_MONTHS - 1 - index), 1)),
  );
}

export function isEmptySummary(summary: RecapSummary): boolean {
  return summary.video.views === 0 && summary.video.activity.totalMs === 0 && summary.music.plays === 0 && summary.music.activity.totalMs === 0;
}

const MIN_ACTIVITY = 20;
const MIN_YEAR_ACTIVITY = 100;

/**
 * The recap waiting to be offered: in January last year's when it held enough, otherwise the month
 * that just closed. Null when nothing is waiting or it was already opened or dismissed.
 */
export function readyPeriod(months: [string, number][], lastShown: string | null, now = new Date()): string | null {
  const activity = new Map(months);
  if (now.getMonth() === 0) {
    const year = String(now.getFullYear() - 1);
    const total = yearMonths(year).reduce((sum, month) => sum + (activity.get(month) ?? 0), 0);
    if (lastShown !== year && total >= MIN_YEAR_ACTIVITY) return year;
  }
  const closed = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  if (lastShown === closed) return null;
  return (activity.get(closed) ?? 0) >= MIN_ACTIVITY ? closed : null;
}
