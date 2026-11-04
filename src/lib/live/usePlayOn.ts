import { useEffect, useMemo, useState } from "react";

import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { usePlayOnStore } from "../../store/usePlayOnStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { activeOf, playOnDevices, type PlayOnDevice } from "./devices";
import type { DeviceKind, Now } from "../api/live";
import { nowOf } from "./now";
import { playing } from "./players";

/** Whether another device can be reached, so "Play on" has something to offer. */
export function usePlayOnAvailable(): boolean {
  return usePlayOnStore((state) => Boolean(state.status?.available));
}

/** The device the user chose to control, while nothing plays here; the remote dock drives it. */
export function useRemoteActive(): string | null {
  const controlling = usePlayOnStore((state) => state.controlling);
  const musicPlaying = useMusicPlayerStore((state) => state.isPlaying);
  const videoPlaying = usePlayerStore((state) => state.isPlaying);
  return musicPlaying || videoPlaying ? null : controlling;
}

/**
 * The group's devices for "Play on", with positions moving every second while one plays, and the
 * one to show: the device playing, or else the one the user chose to control.
 */
export function usePlayOn(): { devices: PlayOnDevice[]; active: PlayOnDevice | null } {
  const status = usePlayOnStore((state) => state.status);
  const linked = usePlayOnStore((state) => state.linked);
  const controlling = usePlayOnStore((state) => state.controlling);
  const available = Boolean(status?.available);
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    if (!available) return;
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [available]);

  const devices = useMemo(() => playOnDevices(status, linked, nowOf(playing()), tick), [status, linked, tick]);
  return { devices, active: activeOf(devices) ?? devices.find((device) => device.did === controlling) ?? null };
}

/** The device controlled from here, with what it plays; `null` while playback is here. */
export interface ControlledDevice {
  did: string;
  name: string;
  kind: DeviceKind;
  now: Now & { video: string };
  nowAtMs: number;
}

export function useControlledDevice(): ControlledDevice | null {
  const did = usePlayOnStore((state) => state.controlling);
  const device = usePlayOnStore((state) => (did ? state.status?.devices[did] : undefined));
  const name = usePlayOnStore((state) => state.linked.find((linked) => linked.id === did)?.name ?? "");
  const now = device?.now;
  if (!did || !device || !now?.video) return null;
  return { did, name, kind: device.kind ?? "phone", now: { ...now, video: now.video }, nowAtMs: device.nowAtMs };
}
