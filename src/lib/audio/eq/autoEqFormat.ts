import { sanitizeBand, sanitizeCurve } from "./limits";
import { APO_CODES, defaultQ, EqLimits, hasGain, type EqBand, type EqCurve, type EqFilterType } from "./models";

/** What an EqualizerAPO / AutoEQ `ParametricEQ.txt` import produced, and what it left out. */
export interface AutoEqImport {
  curve: EqCurve;
  skippedFilters: number;
  ignoredLines: number;
  truncatedFilters: number;
}

/*
 * Reads and writes the EqualizerAPO parametric text format that AutoEQ publishes, for example
 * `Filter 1: ON PK Fc 105 Hz Gain -2.3 dB Q 0.70`. Ported from Android's `AutoEqFormat.kt`:
 * lenient about case, spacing, comma decimals and the short type names; strict about anything that
 * would break the audio, such as Q 0.
 */
const FILTER_PREFIX = /^filter\s*\d*\s*:/i;
const PREAMP_PREFIX = /^preamp\s*:/i;
const NUMBER = /^[-+]?\d+(?:[.,]\d+)?$/;
const THOUSANDS = /^\d{1,2},\d{3}$/;

const TYPES: Record<string, EqFilterType> = {
  PK: "PEAK",
  PEQ: "PEAK",
  MODAL: "PEAK",
  LS: "LOW_SHELF",
  LSC: "LOW_SHELF",
  LSQ: "LOW_SHELF",
  HS: "HIGH_SHELF",
  HSC: "HIGH_SHELF",
  HSQ: "HIGH_SHELF",
  LP: "LOW_PASS",
  LPQ: "LOW_PASS",
  HP: "HIGH_PASS",
  HPQ: "HIGH_PASS",
};

const tokens = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);

const toNumber = (text: string | undefined): number | null =>
  text !== undefined && NUMBER.test(text) ? Number(text.replace(",", ".")) : null;

/** "1,000" in a frequency is a thousands separator: no one sets a filter at 1 Hz. */
const toFrequency = (text: string): number | null =>
  THOUSANDS.test(text) ? Number(text.replace(",", "")) : toNumber(text);

function bandwidthToQ(octaves: number): number | null {
  if (octaves <= 0) return null;
  const ratio = Math.pow(2, octaves);
  return Math.sqrt(ratio) / (ratio - 1);
}

function parseFilter(parts: string[]): EqBand | null {
  const [state, code] = parts;
  if (state?.toUpperCase() !== "ON" || code === undefined) return null;
  const type = TYPES[code.toUpperCase()];
  if (!type) return null;
  let frequency: number | null = null;
  let gain = 0;
  let q: number | null = null;
  let i = 2;
  while (i < parts.length) {
    const key = parts[i]?.toLowerCase();
    const next = parts[i + 1];
    const value = toNumber(next);
    if (key === "fc" && next !== undefined && value !== null) {
      frequency = toFrequency(next);
      i += 2;
    } else if (key === "gain" && value !== null) {
      gain = value;
      i += 2;
    } else if (key === "q" && value !== null) {
      q = value;
      i += 2;
    } else if (key === "bw" && parts[i + 1]?.toLowerCase() === "oct") {
      const octaves = toNumber(parts[i + 2]);
      q = (octaves !== null ? bandwidthToQ(octaves) : null) ?? q;
      i += 3;
    } else {
      i++;
    }
  }
  if (frequency === null) return null;
  return sanitizeBand({ frequency, gain, q: q ?? defaultQ(type), type, enabled: true });
}

/** Null when the text holds no usable filter and no preamp. */
export function parseAutoEq(text: string): AutoEqImport | null {
  let preamp: number | null = null;
  const bands: EqBand[] = [];
  let skipped = 0;
  let ignored = 0;
  for (const raw of text.split(/\r?\n|\r/)) {
    const line = (raw.split("#")[0] ?? "").trim();
    if (!line) continue;
    const afterColon = line.slice(line.indexOf(":") + 1);
    if (PREAMP_PREFIX.test(line)) {
      preamp = tokens(afterColon).map(toNumber).find((n) => n !== null) ?? preamp;
    } else if (FILTER_PREFIX.test(line)) {
      const parsed = parseFilter(tokens(afterColon));
      if (parsed) bands.push(parsed);
      else skipped++;
    } else {
      ignored++;
    }
  }
  if (bands.length === 0 && preamp === null) return null;
  return {
    curve: sanitizeCurve({ preamp: preamp ?? 0, bands: bands.slice(0, EqLimits.MAX_BANDS) }),
    skippedFilters: skipped,
    ignoredLines: ignored,
    truncatedFilters: Math.max(0, bands.length - EqLimits.MAX_BANDS),
  };
}

export function formatAutoEq(curve: EqCurve): string {
  let out = `Preamp: ${curve.preamp.toFixed(1)} dB\n`;
  curve.bands.forEach((b, index) => {
    out += `Filter ${index + 1}: ${b.enabled ? "ON " : "OFF "}${APO_CODES[b.type]}`;
    out += ` Fc ${b.frequency.toFixed(0)} Hz`;
    if (hasGain(b.type)) out += ` Gain ${b.gain.toFixed(1)} dB`;
    out += ` Q ${b.q.toFixed(3)}\n`;
  });
  return out;
}
