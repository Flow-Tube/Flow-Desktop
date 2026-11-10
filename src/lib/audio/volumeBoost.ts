import { useCallback } from "react";
import { videoEqAvailable } from "./mediaEqEngine";
import { SETTINGS } from "../settings/schema";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { usePlayerStore } from "../../store/usePlayerStore";

/** How far above 100% the player goes. The equalizer's soft clipper keeps it from distorting harshly. */
export const MAX_VOLUME_BOOST = 2;

/**
 * Element volume stops at 1, so a level above that is the element at full volume plus WebAudio gain.
 * Everything else that reads the volume (Shorts, Play on, the elements themselves) keeps seeing 0 to 1.
 */
export function splitVolumeLevel(level: number, max: number): { volume: number; boost: number } {
  const clamped = Math.min(max, Math.max(0, level));
  return { volume: Math.min(1, clamped), boost: Math.max(1, clamped) };
}

export function volumeLevel(volume: number, boost: number, allowBoost: boolean): number {
  return volume >= 1 && allowBoost ? Math.max(1, boost) : volume;
}

/** The player's volume as one number that can pass 100% while Volume boost is on. */
export function useVolumeLevel() {
  // The extra gain is WebAudio's, so where WebAudio failed the slider stops at what it can deliver.
  const allowBoost = useAppSettingsStore((s) => s.values[SETTINGS.ALLOW_VOLUME_BOOST] === "true") && videoEqAvailable();
  const volume = usePlayerStore((s) => s.volume);
  const boost = usePlayerStore((s) => s.volumeBoost);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const setVolumeBoost = usePlayerStore((s) => s.setVolumeBoost);
  const maxLevel = allowBoost ? MAX_VOLUME_BOOST : 1;

  const setLevel = useCallback(
    (level: number) => {
      const next = splitVolumeLevel(level, maxLevel);
      setVolume(next.volume);
      setVolumeBoost(next.boost);
    },
    [maxLevel, setVolume, setVolumeBoost],
  );

  return { level: volumeLevel(volume, boost, allowBoost), maxLevel, setLevel, gain: allowBoost && volume >= 1 ? Math.max(1, boost) : 1 };
}
