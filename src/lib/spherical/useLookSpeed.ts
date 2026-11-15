import { SETTINGS } from "../settings/schema";
import { usePreference } from "../usePreference";
import { LOOK_SPEEDS } from "./view";

/** How fast a drag turns a 360 video, one of Android's four speeds. */
export function useLookSpeed(): [number, (speed: number) => void] {
  const [stored, setStored] = usePreference(SETTINGS.SPHERICAL_DRAG_SPEED);
  const speed = Number(stored);
  return [(LOOK_SPEEDS as readonly number[]).includes(speed) ? speed : 1, (next) => setStored(String(next))];
}
