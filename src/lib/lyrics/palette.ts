import type { ArtworkSwatches } from "../color/artworkSwatches";
import { parseComputedColor, resolveCssColors } from "../color/resolveCssColor";
import { contrastRatio } from "../color/tone";
import type { StringKey } from "../i18n/index";
import type { Rgb } from "../useDominantColor";
import type { LyricsCover } from "./display/coverMesh";

/** The card looks, after Android's LyricsCardStyle: the cover's colour field, its swatches, and the app theme. */
export type CardStyleId = "cover" | "artwork" | "accent" | "surface" | "inverse" | "primary";

export interface CardStyle {
  id: CardStyleId;
  ground: Rgb;
  ink: Rgb;
  /** The cover drawn as a soft colour field; only the cover style has one. */
  mesh?: Uint8ClampedArray;
}

export const CARD_STYLE_LABELS: Record<CardStyleId, StringKey> = {
  cover: "lyrics_share_style_cover",
  artwork: "lyrics_share_style_artwork",
  accent: "lyrics_share_style_accent",
  surface: "lyrics_share_style_surface",
  inverse: "lyrics_share_style_inverse",
  primary: "lyrics_share_style_primary",
};

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const NEAR_BLACK: Rgb = { r: 17, g: 17, b: 17 };

// About 15 of 255 across red, green and blue together: closer than that, two swatches read as one.
export const SAME_GROUND_DISTANCE = 0.06;

export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot((a.r - b.r) / 255, (a.g - b.g) / 255, (a.b - b.b) / 255);
}

/** White or near-black, whichever reads better on `ground`. */
export function inkFor(ground: Rgb): Rgb {
  return contrastRatio(WHITE, ground) >= contrastRatio(NEAR_BLACK, ground) ? WHITE : NEAR_BLACK;
}

/** Drops looks whose ground can't be told apart from an earlier one. The cover look always stays. */
export function distinctCardStyles(styles: CardStyle[]): CardStyle[] {
  const kept: CardStyle[] = [];
  for (const style of styles) {
    if (style.mesh || !kept.some((other) => !other.mesh && colorDistance(other.ground, style.ground) < SAME_GROUND_DISTANCE)) {
      kept.push(style);
    }
  }
  return kept;
}

export interface ThemeCardColors {
  surface: Rgb;
  onSurface: Rgb;
  primary: Rgb;
  onPrimary: Rgb;
}

/** The app theme's colours as they paint now, custom themes included; null if any can't be read. */
export function readThemeCardColors(): ThemeCardColors | null {
  const [surface, onSurface, primary, onPrimary] = resolveCssColors([
    "var(--color-surface-container-highest)",
    "var(--color-on-surface)",
    "var(--color-primary)",
    "var(--color-on-primary)",
  ]).map(parseComputedColor);
  if (!surface || !onSurface || !primary || !onPrimary) return null;
  return { surface, onSurface, primary, onPrimary };
}

/** Every look the card offers for this cover and theme, look-alikes dropped. */
export function cardStyles(cover: LyricsCover | null, swatches: ArtworkSwatches | null, theme: ThemeCardColors | null): CardStyle[] {
  const styles: CardStyle[] = [];
  // The field is darkened until white keeps 7:1 on its brightest cell, as on the lyrics screen.
  if (cover) styles.push({ id: "cover", ground: cover.backdrop, ink: WHITE, mesh: cover.mesh });
  if (swatches?.base) styles.push({ id: "artwork", ground: swatches.base, ink: inkFor(swatches.base) });
  if (swatches?.accent) styles.push({ id: "accent", ground: swatches.accent, ink: inkFor(swatches.accent) });
  if (theme) {
    styles.push(
      { id: "surface", ground: theme.surface, ink: theme.onSurface },
      { id: "inverse", ground: theme.onSurface, ink: theme.surface },
      { id: "primary", ground: theme.primary, ink: theme.onPrimary },
    );
  }
  if (styles.length === 0) styles.push({ id: "surface", ground: NEAR_BLACK, ink: WHITE });
  return distinctCardStyles(styles);
}
