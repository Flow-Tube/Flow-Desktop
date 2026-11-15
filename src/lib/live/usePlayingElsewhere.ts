import { useEffect, useMemo, useState } from "react";

import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { usePlayOnStore } from "../../store/usePlayOnStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { findPlayingElsewhere } from "./elsewhere";
import type { ControlledDevice } from "./usePlayOn";

/**
 * Another device playing on its own while this one plays nothing and drives none, for the player
 * bar to offer. It goes when that device's `now` grows stale, checked once at that moment by one
 * timer rather than by polling.
 */
export function usePlayingElsewhere(): ControlledDevice | null {
  const status = usePlayOnStore((state) => state.status);
  const controlling = usePlayOnStore((state) => state.controlling);
  const closed = usePlayOnStore((state) => state.closedHints);
  const linked = usePlayOnStore((state) => state.linked);
  const musicHere = useMusicPlayerStore((state) => Boolean(state.currentTrack));
  const videoHere = usePlayerStore((state) => Boolean(state.currentVideo));
  const idleHere = !musicHere && !videoHere;
  const [expired, setExpired] = useState(0);

  const found = useMemo(
    () => (idleHere ? findPlayingElsewhere(status, controlling, closed, Date.now()) : null),
    [idleHere, status, controlling, closed, expired],
  );

  useEffect(() => {
    if (!found) return;
    const timer = setTimeout(() => setExpired((count) => count + 1), Math.max(0, found.expiresAtMs - Date.now()));
    return () => clearTimeout(timer);
  }, [found]);

  if (!found) return null;
  return {
    did: found.did,
    name: linked.find((device) => device.id === found.did)?.name ?? "",
    kind: status?.devices[found.did]?.kind ?? "phone",
    now: found.now,
    nowAtMs: found.nowAtMs,
  };
}
