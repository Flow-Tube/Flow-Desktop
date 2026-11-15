import { useEffect, useRef, useState } from "react";

import type { Now } from "../api/live";
import { useDebounce } from "../useDebounce";

/** How long the slider rests before its value is sent. */
const SETTLE_MS = 250;

/** A volume the user picked on one device's slider. */
export interface VolumePick {
  did: string;
  vol: number;
}

/** A pick once its command was answered: whether the device took it, and the `now` shown then. */
export interface SentPick {
  pick: VolumePick;
  ok: boolean;
  seen: Now | null;
}

/**
 * Whether the slider goes back to the device's volume: never while the user holds it or before the
 * pick was answered; then once the device refused, shows the pick, or reported anything newer.
 */
export function pickDone(pick: VolumePick, sent: SentPick | null, holding: boolean, now: Now | null): boolean {
  if (holding || !sent || sent.pick !== pick) return false;
  return !sent.ok || now?.vol === pick.vol || now !== sent.seen;
}

/**
 * The volume a device's slider shows: the device's own, followed as it changes and as the device
 * shown changes, except for what the user picks, which `send` sends once the slider rests.
 */
export function useVolumePick(
  did: string,
  now: Now | null,
  send: (vol: number) => Promise<boolean>,
): { volume: number; pick: (vol: number) => void; hold: () => void } {
  const [pick, setPick] = useState<VolumePick | null>(null);
  const [sent, setSent] = useState<SentPick | null>(null);
  const [holding, setHolding] = useState(false);
  const picked = pick?.did === did ? pick : null;
  const settled = useDebounce(picked, SETTLE_MS);
  const latest = useRef({ did, now, send });
  latest.current = { did, now, send };

  useEffect(() => {
    if (!settled || settled.did !== latest.current.did) return;
    const answered = (ok: boolean) => setSent({ pick: settled, ok, seen: latest.current.now });
    if (settled.vol === latest.current.now?.vol) answered(true);
    else void latest.current.send(settled.vol).then(answered, () => answered(false));
  }, [settled]);

  useEffect(() => {
    if (pick && (pick.did !== did || pickDone(pick, sent, holding, now))) setPick(null);
  }, [did, pick, sent, holding, now]);

  useEffect(() => {
    if (!holding) return;
    const release = () => setHolding(false);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [holding]);

  return {
    volume: picked?.vol ?? now?.vol ?? 0,
    pick: (vol) => setPick({ did, vol }),
    hold: () => setHolding(true),
  };
}
