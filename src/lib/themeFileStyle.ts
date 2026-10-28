import { stripRemoteResources } from "./themeFile";

const STYLE_ID = "flow-theme-file";

/**
 * Puts the theme file's CSS on the page after Flow's own styles, so its rules win
 * over Tailwind's layered ones without `!important`. The sheet stays switched off
 * until its remote loads are stripped. Returns how many were stripped.
 */
export function applyThemeFileCss(css: string): number {
  removeThemeFileCss();
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.media = "not all";
  style.textContent = css;
  document.head.appendChild(style);
  const removed = style.sheet ? stripRemoteResources(style.sheet) : 0;
  style.removeAttribute("media");
  return removed;
}

export function removeThemeFileCss() {
  document.getElementById(STYLE_ID)?.remove();
}

/** A custom property's value on the root, with any `var()` already substituted. */
export function readRootToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name);
}

let pixel: CanvasRenderingContext2D | null | undefined;

/**
 * Any CSS colour as `#rrggbb` (or `#rrggbbaa` when translucent). The browser
 * paints it into one pixel, so `oklch()`, `color-mix()` and named colours all come
 * out as the plain hex the native window background needs.
 */
export function resolveCssColor(value: string): string | null {
  if (typeof CSS === "undefined" || !CSS.supports("color", value)) return null;
  if (pixel === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    pixel = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!pixel) return null;
  pixel.clearRect(0, 0, 1, 1);
  pixel.fillStyle = "#000000";
  pixel.fillStyle = value;
  pixel.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = pixel.getImageData(0, 0, 1, 1).data;
  const hex = (channel: number | undefined) => (channel ?? 0).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}${a === 255 ? "" : hex(a)}`;
}
