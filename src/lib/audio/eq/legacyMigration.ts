import { GraphicEq, roundTo } from "./limits";
import type { EqState } from "./models";
import { defaultEqState, sanitizeState } from "./stateOps";

/** Where the first desktop equalizer kept its switch and ten gains, beside the music volume. */
export const LEGACY_MUSIC_CONFIG_KEY = "flow_music_player";

export interface LegacyEqConfig {
  eqEnabled?: unknown;
  eqGains?: unknown;
}

/**
 * The first desktop equalizer as an `EqState`, or null when it was never used. Its ten bands sat
 * on the same octaves as Android's graphic mode (32 and 64 Hz are now 31 and 63), so the gains
 * carry over as a graphic curve; its end bands were shelves and are now peaks, a small change at
 * both ends of the range.
 */
export function migrateLegacyEq(config: LegacyEqConfig | null): EqState | null {
  if (!config) return null;
  const raw = Array.isArray(config.eqGains) ? config.eqGains : [];
  const gains = GraphicEq.FREQUENCIES.map((_, i) => {
    const value = Number(raw[i]);
    const gain = Number.isFinite(value) ? Math.max(-GraphicEq.MAX_GAIN, Math.min(GraphicEq.MAX_GAIN, value)) : 0;
    return roundTo(gain, GraphicEq.STEP);
  });
  const enabled = config.eqEnabled === true;
  if (!enabled && gains.every((g) => g === 0)) return null;
  return sanitizeState({
    ...defaultEqState(),
    enabled,
    mode: "GRAPHIC",
    graphic: { presetId: null, curve: GraphicEq.curveOf(gains) },
  });
}

/** The legacy fields as the old store saved them, or null when there are none. */
export function readLegacyEqConfig(): LegacyEqConfig | null {
  try {
    const saved = localStorage.getItem(LEGACY_MUSIC_CONFIG_KEY);
    if (!saved) return null;
    const parsed: unknown = JSON.parse(saved);
    return typeof parsed === "object" && parsed !== null ? (parsed as LegacyEqConfig) : null;
  } catch {
    return null;
  }
}
