import { useEffect, useState } from "react";
import { getPaidPromotion, type PaidPromotionLabel } from "./api/youtube";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { usePlayerStore } from "../store/usePlayerStore";

/**
 * The label for a video whose creator declared paid promotion, for as long as YouTube asks. It costs a
 * request of its own, so it waits until playback has started and only runs with the setting on.
 * YouTube's answer is a nicety, so a failure shows nothing.
 */
export function usePaidPromotion(videoId: string | undefined): PaidPromotionLabel | null {
  const enabled = useAppSettingsStore((s) => s.values[SETTINGS.PAID_PROMOTION_LABEL] === "true");
  const started = usePlayerStore((s) => !!videoId && s.playbackStartedVideoId === videoId);
  const [label, setLabel] = useState<PaidPromotionLabel | null>(null);

  useEffect(() => {
    setLabel(null);
    if (!enabled || !started || !videoId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    getPaidPromotion(videoId)
      .then((answer) => {
        if (cancelled || !answer) return;
        setLabel(answer);
        timer = setTimeout(() => setLabel(null), answer.durationMs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, started, videoId]);

  return label;
}
