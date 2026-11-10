import { useCallback, useEffect, useState } from "react";

import { getRecapWeek, type RecapWeek } from "../api/recap";
import { flushRecapQueue } from "../recap/recapQueue";

/** The last seven days of watching and listening. Read once per visit to the page holding it. */
export function useWatchTimeWeek() {
  const [week, setWeek] = useState<RecapWeek | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    void flushRecapQueue()
      .then(getRecapWeek)
      .then((loaded) => {
        if (!cancelled) setWeek(loaded);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("Failed to read watch time", error);
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { week, failed, retry };
}

const WEEK_DAYS = 7;

export function weekTotals(days: RecapWeek["days"]) {
  const total = days.reduce((sum, [, ms]) => sum + ms, 0);
  return { total, dailyAverage: total / WEEK_DAYS, empty: total === 0 };
}

/** Whether any of these days comes before the ledger started counting exactly. */
export function weekIsEstimated(week: RecapWeek): boolean {
  const first = week.days[0]?.[0];
  if (!first) return false;
  const [year, month, day] = first.split("-").map(Number);
  return week.startedAt > new Date(year!, month! - 1, day!).getTime();
}
