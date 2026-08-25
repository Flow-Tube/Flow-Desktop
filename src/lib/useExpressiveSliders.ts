import { SETTINGS } from './settings/schema';
import { useBoolPref } from './usePreference';

/** Off puts every converted slider back on the plain native control. */
export function useExpressiveSliders(): boolean {
  const [enabled] = useBoolPref(SETTINGS.EXPRESSIVE_SLIDERS_ENABLED, true);
  return enabled;
}
