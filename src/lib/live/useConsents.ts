import { useCallback, useEffect, useState } from "react";

import { getConsents, setConsent } from "../api/live";

export type Consent = "ask" | "allow" | "decline";

/** Whether each device may play on or control this one, changed at once and then saved. */
export function useConsents(): [Record<string, Consent>, (did: string, consent: Consent) => void] {
  const [consents, setConsents] = useState<Record<string, Consent>>({});

  useEffect(() => {
    getConsents().then(
      (answers) =>
        setConsents(Object.fromEntries(Object.entries(answers).map(([did, allowed]) => [did, allowed ? "allow" : "decline"]))),
      () => undefined,
    );
  }, []);

  const change = useCallback((did: string, consent: Consent) => {
    setConsents((current) => ({ ...current, [did]: consent }));
    void setConsent(did, consent === "ask" ? null : consent === "allow").catch(() => undefined);
  }, []);

  return [consents, change];
}
