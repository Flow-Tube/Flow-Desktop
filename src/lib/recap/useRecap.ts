import { useCallback, useEffect, useRef, useState } from "react";

import { getRecapIndex, getRecapSummary, type RecapIndex, type RecapSource, type RecapSummary } from "../api/recap";
import { profileStorage } from "../storage/profileStorage";
import { flushRecapQueue } from "./recapQueue";

const SOURCE_KEY = "flow_recap_source";

function rememberedSource(): RecapSource {
  const saved = profileStorage.getItem(SOURCE_KEY);
  return saved === "VIDEO" || saved === "MUSIC" ? saved : "ALL";
}

export interface RecapState {
  loading: boolean;
  error: boolean;
  index: RecapIndex | null;
  period: string;
  source: RecapSource;
  summary: RecapSummary | null;
  selectPeriod: (period: string) => void;
  selectSource: (source: RecapSource) => void;
  retry: () => void;
}

/** The recap page's data: the ledger's index, then one fold per period and source picked. */
export function useRecap(startAt?: string | null): RecapState {
  const [index, setIndex] = useState<RecapIndex | null>(null);
  const [period, setPeriod] = useState(startAt ?? "");
  const [source, setSource] = useState<RecapSource>(rememberedSource);
  const [summary, setSummary] = useState<RecapSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    // What was just watched should be in the recap that opens now.
    void flushRecapQueue()
      .then(getRecapIndex)
      .then((loaded) => {
        if (cancelled) return;
        setIndex(loaded);
        setPeriod((current) => current || loaded.months[0]?.[0] || "");
        if (loaded.months.length === 0) setLoading(false);
      })
      .catch((reason) => {
        if (cancelled) return;
        console.warn("Failed to open the recap", reason);
        setError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    if (!index || !period) return;
    const request = ++latest.current;
    setLoading(true);
    setError(false);
    void getRecapSummary(period, source)
      .then((loaded) => {
        if (request === latest.current) setSummary(loaded);
      })
      .catch((reason) => {
        if (request !== latest.current) return;
        console.warn("Failed to fold the recap", reason);
        setError(true);
      })
      .finally(() => {
        if (request === latest.current) setLoading(false);
      });
  }, [index, period, source]);

  const selectSource = useCallback((next: RecapSource) => {
    profileStorage.setItem(SOURCE_KEY, next);
    setSource(next);
  }, []);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return { loading, error, index, period, source, summary, selectPeriod: setPeriod, selectSource, retry };
}
