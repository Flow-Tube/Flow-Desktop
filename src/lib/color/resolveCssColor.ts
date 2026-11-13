import type { Rgb } from "../useDominantColor";

/**
 * What each CSS colour paints as right now, theme variables included, read through one probe
 * element so custom themes' `color-mix()` values resolve too. `variables` are set on the probe first.
 */
export function resolveCssColors(colors: readonly string[], variables: Record<string, string> = {}): string[] {
  const probe = document.createElement("div");
  for (const [name, value] of Object.entries(variables)) probe.style.setProperty(name, value);
  document.body.append(probe);
  const resolved = colors.map((color) => {
    probe.style.color = color;
    return getComputedStyle(probe).color;
  });
  probe.remove();
  return resolved;
}

/** A computed colour (`rgb()`, `rgba()` or `color(srgb …)`) as Rgb, alpha dropped; null for anything else. */
export function parseComputedColor(value: string): Rgb | null {
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(value);
  if (rgb) return { r: Math.round(Number(rgb[1])), g: Math.round(Number(rgb[2])), b: Math.round(Number(rgb[3])) };
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value);
  if (srgb) return { r: Math.round(Number(srgb[1]) * 255), g: Math.round(Number(srgb[2]) * 255), b: Math.round(Number(srgb[3]) * 255) };
  return null;
}
