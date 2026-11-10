import { getString, type StringKey } from "../i18n/index";
import type { CrossfadeCurve } from "./crossfadeRamp";

/** "250 ms" under a second, "3 s" from one, as Android writes them. */
export const crossfadeLengthLabel = (seconds: number): string =>
  seconds < 1
    ? getString("music_crossfade_ms", Math.round(seconds * 1_000))
    : getString("music_crossfade_seconds", seconds);

/** The curves in the order settings list them, with their names and what each sounds like. */
export const CROSSFADE_CURVES: ReadonlyArray<{ value: CrossfadeCurve; label: StringKey; description: StringKey }> = [
  { value: "EQUAL_POWER", label: "crossfade_curve_equal_power", description: "crossfade_curve_equal_power_desc" },
  { value: "S_CURVE", label: "crossfade_curve_s_curve", description: "crossfade_curve_s_curve_desc" },
  { value: "HOLD", label: "crossfade_curve_hold", description: "crossfade_curve_hold_desc" },
  { value: "GENTLE", label: "crossfade_curve_gentle", description: "crossfade_curve_gentle_desc" },
];
