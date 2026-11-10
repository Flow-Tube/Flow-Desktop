import { useCallback, useEffect, useRef, useState } from "react";

export type VolumeFeedback = {
  /** New on every change, so the pill's fade replays per wheel step. */
  id: number;
  volume: number;
  muted: boolean;
};

const VOLUME_FEEDBACK_MS = 1200;

/** The short-lived volume reading shown after a wheel or key change. */
export function useVolumeFeedback() {
  const [feedback, setFeedback] = useState<VolumeFeedback | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const show = useCallback((volume: number, muted: boolean) => {
    setFeedback((previous) => ({ id: (previous?.id ?? 0) + 1, volume, muted }));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setFeedback(null);
    }, VOLUME_FEEDBACK_MS);
  }, []);

  return { feedback, show };
}
