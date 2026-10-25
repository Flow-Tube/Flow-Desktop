/** "1k", "16k", "250": the way frequency axes are usually labelled. */
export function formatFrequency(hz: number): string {
  if (hz >= 1_000) {
    const k = hz / 1_000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return String(Math.round(hz));
}

/** A signed gain with one decimal where it has one: "+3", "-1.5", "0". */
export function formatDb(db: number): string {
  const rounded = Math.round(db * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return rounded > 0 ? `+${text}` : text;
}
