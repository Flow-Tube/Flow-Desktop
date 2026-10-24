import { useMemo, type CSSProperties } from "react";

import type { ArtworkSwatches } from "./color/artworkSwatches";
import { parseHex } from "./color/tone";
import {
  isPlayerBackgroundStyle,
  playerColors,
  playerCssVariables,
  playerTurnsLight,
  toggleColorsOn,
  type PlainControlColors,
  type PlayerBackgroundStyle,
  type PlayerColors,
} from "./playerColors";
import { SETTINGS } from "./settings/schema";
import { darkVariantOf, scopeVariables, type ThemeVariant } from "./themes";
import { useBoolPref, usePreference } from "./usePreference";
import { useTheme } from "./useTheme";

function usePlayerColorPrefs() {
  const [styleValue] = usePreference(SETTINGS.MUSIC_PLAYER_BACKGROUND);
  const [artworkControls] = useBoolPref(SETTINGS.MUSIC_ARTWORK_CONTROL_COLORS);
  const [plainValue] = usePreference(SETTINGS.MUSIC_PLAIN_CONTROL_COLORS);
  const [followLightTheme] = useBoolPref(SETTINGS.MUSIC_PLAYER_FOLLOW_LIGHT_THEME);
  const style: PlayerBackgroundStyle = isPlayerBackgroundStyle(styleValue) ? styleValue : "blur_gradient";
  const plainControls: PlainControlColors = plainValue === "app_theme" ? "app_theme" : "monochrome";
  return { style, artworkControls, plainControls, followLightTheme };
}

export interface FullPlayerColors {
  style: PlayerBackgroundStyle;
  colors: PlayerColors;
  /** Theme tokens for the variant the player is drawn in, plus the `--player-*` roles. */
  rootStyle: CSSProperties;
}

/**
 * The full player's colours. It is drawn dark in every theme, as on Android,
 * unless it follows the app (the Default style) or the user turned on the
 * light player for light themes.
 */
export function useFullPlayerColors(swatches: ArtworkSwatches | null): FullPlayerColors {
  const { theme, variant } = useTheme();
  const { style, artworkControls, plainControls, followLightTheme } = usePlayerColorPrefs();
  const appSurface = parseHex(theme.variants[variant].background) ?? { r: 0, g: 0, b: 0 };
  const light = playerTurnsLight(style, followLightTheme, appSurface);
  const scope: ThemeVariant = style === "default" ? variant : light ? "light" : darkVariantOf(variant);

  return useMemo(() => {
    const colors = playerColors({ swatches, style, app: theme.variants[scope], light, artworkControls, plainControls });
    const rootStyle = {
      ...scopeVariables(theme, scope),
      ...playerCssVariables(colors),
      colorScheme: scope === "light" ? "light" : "dark",
    } as CSSProperties;
    return { style, colors, rootStyle };
  }, [swatches, style, theme, scope, light, artworkControls, plainControls]);
}

/** A switched-on toggle in the dock, readable on the dock's own surface. */
export function useDockToggleColors(swatches: ArtworkSwatches | null): CSSProperties {
  const { theme, variant } = useTheme();
  const { artworkControls, plainControls } = usePlayerColorPrefs();
  const app = theme.variants[variant];
  return useMemo(() => {
    const surface = parseHex(app.surfaceContainerHigh) ?? { r: 36, g: 36, b: 36 };
    return toggleColorsOn(surface, swatches, app, artworkControls, plainControls);
  }, [app, swatches, artworkControls, plainControls]);
}
