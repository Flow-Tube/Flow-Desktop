import { useEffect, useMemo, useState } from "react";

import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { usePlayOnStore } from "../../store/usePlayOnStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { activeOf, playOnDevices, type PlayOnDevice } from "./devices";
import { nowOf } from "./now";
import { playing } from "./players";

/** Whether another device can be reached, so "Play on" has something to offer. */
export function usePlayOnAvailable(): boolean {
  return usePlayOnStore((state) => Boolean(state.status?.available));
}

/** The other device shown as playing (or paused there) while nothing plays here; its controls take over. */
export function useRemoteActive(): string | null {
  const focus = usePlayOnStore((state) => state.focus);
  const musicPlaying = useMusicPlayerStore((state) => state.isPlaying);
  const videoPlaying = usePlayerStore((state) => state.isPlaying);
  return musicPlaying || videoPlaying ? null : focus;
}

/**
 * The group's devices for "Play on", with positions moving every second while one plays, and the
 * one to show: the device playing, or the one shown last while it stays paused.
 */
export function usePlayOn(): { devices: PlayOnDevice[]; active: PlayOnDevice | null } {
  const status = usePlayOnStore((state) => state.status);
  const linked = usePlayOnStore((state) => state.linked);
  const focus = usePlayOnStore((state) => state.focus);
  const available = Boolean(status?.available);
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    if (!available) return;
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [available]);

  const devices = useMemo(() => playOnDevices(status, linked, nowOf(playing()), tick), [status, linked, tick]);
  return { devices, active: activeOf(devices) ?? devices.find((device) => device.did === focus) ?? null };
}
