import type { ArtworkSwatches } from "../color/artworkSwatches";
import { parseComputedColor, resolveCssColors } from "../color/resolveCssColor";
import { contrastRatio, fromLab, luminance, toLab } from "../color/tone";
import type { StringKey } from "../i18n/index";
import type { Rgb } from "../useDominantColor";
import type { LyricsCover } from "./display/coverMesh";

/** Android's LyricsCardStyle, in its order: the cover's swatch and colour field, then the colour roles. */
export const CARD_STYLE_IDS = [
  "artwork",
  "colorful",
  "surface",
  "inverse",
  "primary",
  "primaryContainer",
  "secondaryContainer",
  "tertiary",
  "tertiaryContainer",
] as const;

export type CardStyleId = (typeof CARD_STYLE_IDS)[number];

export interface CardStyle {
  id: CardStyleId;
  ground: Rgb;
  ink: Rgb;
  /** The cover drawn as a soft colour field; only the colorful style has one. */
  mesh?: Uint8ClampedArray;
}

export const CARD_STYLE_LABELS: Record<CardStyleId, StringKey> = {
  artwork: "lyrics_share_style_artwork",
  colorful: "lyrics_share_style_cover",
  surface: "lyrics_share_style_surface",
  inverse: "lyrics_share_style_inverse",
  primary: "lyrics_share_style_primary",
  primaryContainer: "lyrics_share_style_primary_container",
  secondaryContainer: "lyrics_share_style_secondary_container",
  tertiary: "lyrics_share_style_tertiary",
  tertiaryContainer: "lyrics_share_style_tertiary_container",
};

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const NEAR_BLACK: Rgb = { r: 17, g: 17, b: 17 };

// About 15 of 255 across red, green and blue together: closer than that, two swatches read as one.
export const SAME_GROUND_DISTANCE = 0.06;

export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot((a.r - b.r) / 255, (a.g - b.g) / 255, (a.b - b.b) / 255);
}

export const looksAlike = (a: Rgb, b: Rgb) => colorDistance(a, b) < SAME_GROUND_DISTANCE;

/** White or near-black, whichever reads better on `ground`. */
export function inkFor(ground: Rgb): Rgb {
  return contrastRatio(WHITE, ground) >= contrastRatio(NEAR_BLACK, ground) ? WHITE : NEAR_BLACK;
}

/** The Material colour roles the card offers, as Android's music player builds them from the cover. */
export interface CardScheme {
  surfaceContainerHighest: Rgb;
  onSurface: Rgb;
  inverseSurface: Rgb;
  inverseOnSurface: Rgb;
  primary: Rgb;
  onPrimary: Rgb;
  primaryContainer: Rgb;
  onPrimaryContainer: Rgb;
  secondaryContainer: Rgb;
  onSecondaryContainer: Rgb;
  tertiary: Rgb;
  onTertiary: Rgb;
  tertiaryContainer: Rgb;
  onTertiaryContainer: Rgb;
}

// Material's tonal-spot scheme: a vivid primary, a muted secondary, a tertiary turned 60 degrees,
// near-grey surfaces. A grey seed (a black and white cover, a monochrome theme) stays grey.
const PRIMARY_CHROMA = 40;
const SECONDARY_CHROMA = 16;
const TERTIARY_CHROMA = 28;
const NEUTRAL_CHROMA = 4;
const TERTIARY_TURN = Math.PI / 3;
const GREY_SEED = 6;

/** A role from the seed's hue: CIELAB tone and chroma, the hue turned by `turn` radians. */
function role(seed: Rgb, tone: number, chroma: number, turn = 0): Rgb {
  const [, a, b] = toLab(seed);
  const seedChroma = Math.hypot(a, b);
  const c = seedChroma < GREY_SEED ? Math.min(seedChroma, chroma) : chroma;
  const hue = Math.atan2(b, a) + turn;
  return fromLab(tone, c * Math.cos(hue), c * Math.sin(hue));
}

export function cardScheme(seed: Rgb, light: boolean): CardScheme {
  const p = (tone: number) => role(seed, tone, PRIMARY_CHROMA);
  const s = (tone: number) => role(seed, tone, SECONDARY_CHROMA);
  const t = (tone: number) => role(seed, tone, TERTIARY_CHROMA, TERTIARY_TURN);
  const n = (tone: number) => role(seed, tone, NEUTRAL_CHROMA);
  return light
    ? {
        surfaceContainerHighest: n(90),
        onSurface: n(10),
        inverseSurface: n(20),
        inverseOnSurface: n(95),
        primary: p(40),
        onPrimary: WHITE,
        primaryContainer: p(90),
        onPrimaryContainer: p(10),
        secondaryContainer: s(90),
        onSecondaryContainer: s(10),
        tertiary: t(40),
        onTertiary: WHITE,
        tertiaryContainer: t(90),
        onTertiaryContainer: t(10),
      }
    : {
        surfaceContainerHighest: n(22),
        onSurface: n(90),
        inverseSurface: n(90),
        inverseOnSurface: n(20),
        primary: p(80),
        onPrimary: p(20),
        primaryContainer: p(30),
        onPrimaryContainer: p(90),
        secondaryContainer: s(30),
        onSecondaryContainer: s(90),
        tertiary: t(80),
        onTertiary: t(20),
        tertiaryContainer: t(30),
        onTertiaryContainer: t(90),
      };
}

export interface AppCardColors {
  primary: Rgb;
  light: boolean;
}

/** The app theme's primary, the seed when there is no cover, and whether the app is light. */
export function readAppCardColors(): AppCardColors | null {
  const [primary, surface] = resolveCssColors(["var(--color-primary)", "var(--color-surface)"]).map(parseComputedColor);
  if (!primary || !surface) return null;
  return { primary, light: luminance(surface) > 0.5 };
}

export interface CardColors {
  styles: CardStyle[];
  scheme: CardScheme;
  /** The cover's accent, the first choice for the framed backdrop. */
  accent: Rgb | null;
}

/** Every look the card offers for this cover and app, in Android's order, look-alikes dropped. */
export function cardColors(cover: LyricsCover | null, swatches: ArtworkSwatches | null, app: AppCardColors | null): CardColors {
  const seed = swatches?.accent ?? swatches?.base ?? app?.primary ?? NEAR_BLACK;
  const scheme = cardScheme(seed, app?.light ?? false);
  const candidates: Record<CardStyleId, CardStyle | null> = {
    artwork: swatches?.base ? { id: "artwork", ground: swatches.base, ink: inkFor(swatches.base) } : null,
    // The field is darkened until white keeps 7:1 on its brightest cell, as on the lyrics screen.
    colorful: cover ? { id: "colorful", ground: cover.backdrop, ink: WHITE, mesh: cover.mesh } : null,
    surface: { id: "surface", ground: scheme.surfaceContainerHighest, ink: scheme.onSurface },
    inverse: { id: "inverse", ground: scheme.inverseSurface, ink: scheme.inverseOnSurface },
    primary: { id: "primary", ground: scheme.primary, ink: scheme.onPrimary },
    primaryContainer: { id: "primaryContainer", ground: scheme.primaryContainer, ink: scheme.onPrimaryContainer },
    secondaryContainer: { id: "secondaryContainer", ground: scheme.secondaryContainer, ink: scheme.onSecondaryContainer },
    tertiary: { id: "tertiary", ground: scheme.tertiary, ink: scheme.onTertiary },
    tertiaryContainer: { id: "tertiaryContainer", ground: scheme.tertiaryContainer, ink: scheme.onTertiaryContainer },
  };
  const styles: CardStyle[] = [];
  for (const id of CARD_STYLE_IDS) {
    const style = candidates[id];
    if (style && (style.mesh || !styles.some((kept) => !kept.mesh && looksAlike(kept.ground, style.ground)))) styles.push(style);
  }
  return { styles, scheme, accent: swatches?.accent ?? null };
}

/** The framed card's margin: the first candidate that doesn't read as the card's own ground. */
export function backdropColor(ground: Rgb, colors: CardColors): Rgb {
  const candidates = [colors.accent, colors.scheme.inverseSurface, colors.scheme.surfaceContainerHighest].filter(
    (candidate): candidate is Rgb => candidate !== null,
  );
  return candidates.find((candidate) => !looksAlike(candidate, ground)) ?? candidates[0]!;
}
