import { useCallback, useEffect, useRef, useState } from "react";
import { getTasteOverview, type TasteOverview } from "./api/recommendation";
import type { StringKey } from "./i18n/index";

const OFTEN_WATCHED = 8;
const SOMETIMES_WATCHED = 3;

/** How often the viewer watched an interest, in words. */
export function evidenceLabel(evidence: number): StringKey {
  if (evidence >= OFTEN_WATCHED) return "taste_evidence_often";
  if (evidence >= SOMETIMES_WATCHED) return "taste_evidence_some";
  if (evidence > 0) return "taste_evidence_once";
  return "taste_evidence_none";
}

const EMPTY: TasteOverview = { picks: [], groups: [], hiddenChannels: [] };

/** Your taste as the engine reads it: picks, learned groups and hidden channels. */
export function useTasteOverview() {
  const [overview, setOverview] = useState<TasteOverview>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const next = await getTasteOverview();
      if (request !== requestRef.current) return;
      setOverview(next);
      setFailed(false);
    } catch (error) {
      console.error("Failed to load the taste overview", error);
      if (request === requestRef.current) setFailed(true);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { overview, loading, failed, refresh };
}
