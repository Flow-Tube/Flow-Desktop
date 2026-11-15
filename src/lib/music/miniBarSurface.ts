import { useMemo, type CSSProperties } from "react";

import type { ArtworkSwatches } from "../color/artworkSwatches";
import { css, luminance, mix, parseHex, withTone } from "../color/tone";
import { darkVariantOf, scopeVariables, type ThemeColors } from "../themes";
import type { Rgb } from "../useDominantColor";
import { useTheme } from "../useTheme";
import type { MiniBarBackground } from "./miniPlayerLook";

const CHROME_STEPS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"] as const;
// How far each neutral step sits from the ink towards the surface: 100 is the text, 800 the border.
const STEP_MIX = [0, 0, 0.08, 0.16, 0.32, 0.48, 0.62, 0.72, 0.82, 0.9, 0.95];
const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

export interface MiniBarSurface {
  /** Variables for the bar's subtree, so its existing classes take the chosen colours. */
  style: CSSProperties;
  /** A line around the edge: the App theme look Desktop always had, and Outlined. */
  bordered: boolean;
  /** The cover's colour field behind the content, under a scrim. */
  coverColors: boolean;
}

/** Neutral steps and containers between `ink` and `surface`, for a bar painted in its own colour. */
function inkScale(surface: Rgb, ink: Rgb): Record<string, string> {
  const variables: Record<string, string> = {
    "--color-surface-container-high": css(surface),
    "--color-surface-container-highest": css(mix(surface, ink, 0.12)),
  };
  CHROME_STEPS.forEach((step, index) => {
    variables[`--color-chrome-neutral-${step}`] = css(mix(ink, surface, STEP_MIX[index]!));
  });
  return variables;
}

/**
 * The paint for each mini player background. Tinted lifts the bar's container towards the cover's
 * accent; Vivid fills it with the cover's container colour; Cover colors and Black are drawn dark
 * in every theme, as the full player is; App theme and Outlined keep the app's own colours.
 */
export function miniBarSurface(
  background: MiniBarBackground,
  swatches: ArtworkSwatches | null,
  app: ThemeColors,
  darkScope: Record<string, string>,
): MiniBarSurface {
  // Theme containers are CSS colour mixes, so light or dark is read from the background.
  const dark = luminance(parseHex(app.background) ?? BLACK) < 0.5;
  const accent = swatches?.accent ?? parseHex(app.primary) ?? WHITE;
  switch (background) {
    case "tinted": {
      const tint = `color-mix(in srgb, ${css(accent)} ${dark ? 16 : 12}%, ${app.surfaceContainerHigh})`;
      return { style: { "--color-surface-container-high": tint } as CSSProperties, bordered: false, coverColors: false };
    }
    case "vivid": {
      const surface = withTone(accent, dark ? 30 : 88);
      const ink = withTone(accent, dark ? 92 : 12);
      const style = { ...inkScale(surface, ink), "--color-primary": css(ink), "--color-on-primary": css(surface) };
      return { style: style as CSSProperties, bordered: false, coverColors: false };
    }
    case "cover_colors":
      return { style: { ...darkScope, "--color-surface-container-high": "transparent" } as CSSProperties, bordered: false, coverColors: true };
    case "black":
      return { style: { ...darkScope, ...inkScale(BLACK, WHITE) } as CSSProperties, bordered: false, coverColors: false };
    case "outlined":
      return {
        style: { "--color-surface-container-high": app.surface, "--color-chrome-neutral-800": app.outline } as CSSProperties,
        bordered: true,
        coverColors: false,
      };
    default:
      return { style: {}, bordered: true, coverColors: false };
  }
}

export function useMiniBarSurface(background: MiniBarBackground, swatches: ArtworkSwatches | null): MiniBarSurface {
  const { theme, variant } = useTheme();
  return useMemo(() => {
    const darkScope = scopeVariables(theme, darkVariantOf(variant));
    return miniBarSurface(background, swatches, theme.variants[variant], darkScope);
  }, [background, swatches, theme, variant]);
}
