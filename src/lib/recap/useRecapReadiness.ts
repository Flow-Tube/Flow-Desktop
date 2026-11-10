import { useCallback, useEffect, useState } from "react";

import { isTauriEnv } from "../api/env";
import { getRecapIndex } from "../api/recap";
import { profileStorage } from "../storage/profileStorage";
import { readyPeriod } from "./recapFormat";

const LAST_SHOWN_KEY = "flow_recap_last_shown";

/** Whether a month or year just closed with a recap worth offering; checked when Library opens. */
export function useRecapReadiness() {
  const [ready, setReady] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void isTauriEnv()
      .then((inTauri) => (inTauri ? getRecapIndex() : null))
      .then((index) => {
        if (!cancelled && index) setReady(readyPeriod(index.months, profileStorage.getItem(LAST_SHOWN_KEY)));
      })
      .catch((reason) => console.warn("Failed to check for a new recap", reason));
    return () => {
      cancelled = true;
    };
  }, []);

  const markHandled = useCallback(() => {
    setReady((period) => {
      if (period) profileStorage.setItem(LAST_SHOWN_KEY, period);
      return null;
    });
  }, []);

  return { ready, markHandled };
}
