import { useEffect, useState } from "react";

import type { ControlledDevice } from "../../lib/live/usePlayOn";
import { positionOf } from "../../lib/live/position";

/** The edge progress bar of a player bar showing another device, moving on while it plays. */
export function RemoteProgress({ device }: { device: ControlledDevice }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const playing = device.now.state === "playing";
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [playing]);
  const fraction = device.now.dur > 0 ? Math.min(1, positionOf(device, nowMs) / device.now.dur) : 0;
  return (
    <span className="absolute inset-x-0 bottom-0 h-0.5 bg-surface-container-highest">
      <span className="block h-full bg-[var(--color-primary)]" style={{ width: `${fraction * 100}%` }} />
    </span>
  );
}
