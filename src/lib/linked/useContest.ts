import { useEffect, useState } from "react";

import { getContest, type ContestSide } from "../api/linked";
import { normalizeBackendError } from "../api/errors";
import { syncErrorMessage } from "../syncErrors";

/** The sides of a roster where two devices removed each other. */
export function useContest() {
  const [sides, setSides] = useState<ContestSide[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    getContest()
      .then((found) => {
        if (current) setSides(found);
      })
      .catch((failure: unknown) => {
        if (!current) return;
        const { kind, message } = normalizeBackendError(failure);
        setError(syncErrorMessage(kind, message));
      });
    return () => {
      current = false;
    };
  }, []);
  return { sides, error };
}
