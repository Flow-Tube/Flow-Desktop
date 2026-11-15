import { IS_LINUX_RUNTIME } from "../platform";
import { usePreference } from "../usePreference";
import { SETTINGS } from "../settings/schema";
import { getString } from "../i18n/index";

/**
 * How a synced line moves as it is sung: letters that rise with the fill, held notes that swell and
 * syllable runs that climb (Cadence); words that lift as they fill (Classic); or the fill alone (Calm).
 */
export type LyricsAnimation = "cadence" | "classic" | "calm";

/** How strongly a long held note glows while it is sung. Normal is how it always glowed. */
export type LyricsGlow = "off" | "soft" | "normal" | "bright";

const ANIMATIONS: readonly LyricsAnimation[] = ["cadence", "classic", "calm"];
const GLOWS: readonly LyricsGlow[] = ["off", "soft", "normal", "bright"];

/** The glow's peak alpha and blur radius in px, as Android's Soft, Normal and Bright. */
export function glowLook(glow: LyricsGlow): { alpha: number; radius: number } {
  switch (glow) {
    case "off":
      return { alpha: 0, radius: 10 };
    case "soft":
      return { alpha: 0.3, radius: 8 };
    case "bright":
      return { alpha: 0.8, radius: 14 };
    default:
      return { alpha: 0.5, radius: 10 };
  }
}

export function useLyricsAnimation(): [LyricsAnimation, (value: string) => void] {
  const [stored, setStored] = usePreference(SETTINGS.LYRICS_ANIMATION_STYLE);
  const value = ANIMATIONS.includes(stored as LyricsAnimation) ? (stored as LyricsAnimation) : "cadence";
  return [value, setStored];
}

/** WebKitGTK draws canvas shadows on the CPU, so Linux never draws the glow and offers no choice. */
export function useLyricsGlow(): [LyricsGlow, (value: string) => void] {
  const [stored, setStored] = usePreference(SETTINGS.LYRICS_GLOW);
  const value = GLOWS.includes(stored as LyricsGlow) ? (stored as LyricsGlow) : "normal";
  return [IS_LINUX_RUNTIME ? "off" : value, setStored];
}

export const CAN_CHOOSE_GLOW = !IS_LINUX_RUNTIME;

export function lyricsAnimationOptions(): Array<{ value: LyricsAnimation; label: string; description: string }> {
  return ANIMATIONS.map((value) => ({
    value,
    label: getString(`lyrics_animation_${value}`),
    description: getString(`lyrics_animation_${value}_detail`),
  }));
}

export function lyricsGlowOptions(): Array<{ value: LyricsGlow; label: string }> {
  return GLOWS.map((value) => ({ value, label: getString(`lyrics_glow_${value}`) }));
}
