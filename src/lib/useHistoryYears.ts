import { useEffect, useMemo, useState } from "react";
import { getWatchHistoryYears } from "./api/db";
import { historyYear } from "./historyFilter";
import type { WatchHistoryRecord } from "../types/db";

/**
 * The years a viewer can narrow history to. History arrives a page at a time, so the backend names
 * them all; the loaded rows add a year it counted differently around New Year, in another time zone.
 */
export function useHistoryYears(records: WatchHistoryRecord[]): number[] {
  const [stored, setStored] = useState<number[]>([]);

  useEffect(() => {
    let current = true;
    void getWatchHistoryYears()
      .then((years) => {
        if (current) setStored(years);
      })
      .catch((error) => console.warn("Failed to read the years in history", error));
    return () => {
      current = false;
    };
  }, []);

  return useMemo(() => {
    const years = new Set(stored);
    for (const record of records) {
      const year = historyYear(record.watchDate);
      if (year !== null) years.add(year);
    }
    return [...years].sort((a, b) => b - a);
  }, [records, stored]);
}
