import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { useWheelVolume } from "./useWheelVolume";

/** `useWheelVolume` for the music player's volume controls. */
export function useMusicWheelVolume<T extends HTMLElement = HTMLDivElement>() {
  const volume = useMusicPlayerStore((s) => s.volume);
  const muted = useMusicPlayerStore((s) => s.isMuted);
  const setVolume = useMusicPlayerStore((s) => s.setVolume);
  const toggleMute = useMusicPlayerStore((s) => s.toggleMute);
  return useWheelVolume<T>({ volume, muted, onVolumeChange: setVolume, onUnmute: toggleMute });
}
