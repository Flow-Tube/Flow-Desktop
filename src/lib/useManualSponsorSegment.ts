import { useEffect, useState } from "react";
import type { SponsorBlockSegment } from "./api/foss";

/**
 * The segment the player's Skip button offers. The player's time updates fill it in, but they stop
 * with the old source, so a button left from it would seek in whatever plays next.
 */
export function useManualSponsorSegment(mediaIdentity: string, sponsorBlockActive: boolean) {
  const [segment, setSegment] = useState<SponsorBlockSegment | null>(null);
  useEffect(() => setSegment(null), [mediaIdentity, sponsorBlockActive]);
  return [segment, setSegment] as const;
}
