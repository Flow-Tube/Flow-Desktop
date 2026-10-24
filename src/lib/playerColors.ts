/**
 * The full player's colours, ported from Flow Android's `MusicPlayerTheme.kt`.
 * Hue and chroma come from the cover; every role sits at a fixed tone and is
 * re-clamped against the surface it is drawn on, so a pale, dark or grey cover
 * never leaves text or controls unreadable.
 */
import type { ArtworkSwatches } from "./color/artworkSwatches";
import { contrastRatio, css, ensureContrastOn, luminance, mix, parseHex, tone, withTone } from "./color/tone";
import type { ThemeColors } from "./themes";
import type { Rgb } from "./useDominantColor";

/** Android's `MusicPlayerBackgroundStyle`, under the same names. */
export type PlayerBackgroundStyle = "blur_gradient" | "blur" | "gradient" | "default";
export const PLAYER_BACKGROUND_STYLES: readonly PlayerBackgroundStyle[] = ["blur_gradient", "blur", "gradient", "default"];

export function isPlayerBackgroundStyle(value: string): value is PlayerBackgroundStyle {
  return (PLAYER_BACKGROUND_STYLES as readonly string[]).includes(value);
}
export type PlainControlColors = "monochrome" | "app_theme";
export const PLAIN_CONTROL_COLORS: readonly PlainControlColors[] = ["monochrome", "app_theme"];

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };
/** Android's `PaletteInkDark`. */
const INK_DARK: Rgb = { r: 22, g: 22, b: 22 };
const NEUTRAL_ACCENT: Rgb = { r: 255, g: 0, b: 51 };

interface Roles {
  surface: Rgb;
  ink: Rgb;
  primary: Rgb;
  onPrimary: Rgb;
  primaryContainer: Rgb;
  onPrimaryContainer: Rgb;
}

/** What the backdrop paints with: the cover's two swatches over a ground. */
export interface BackdropColors {
  ground: Rgb;
  base: Rgb;
  accent: Rgb;
}

/** The artwork styles that have a light version; Immersive keeps its dark scrim over the photo. */
export function canTurnLight(style: PlayerBackgroundStyle): boolean {
  return style === "gradient" || style === "blur" || style === "blur_gradient";
}

/** Light only when the user asked for it and the app itself is light. */
export function playerTurnsLight(style: PlayerBackgroundStyle, followLightTheme: boolean, appSurface: Rgb): boolean {
  return followLightTheme && canTurnLight(style) && luminance(appSurface) > 0.5;
}

const lightSurfaceOf = (base: Rgb) => withTone(base, 95, 12);

function darkRoles(base: Rgb, seed: Rgb): Roles {
  const surface = tone(base) > 30 ? withTone(base, 26) : base;
  return {
    surface,
    ink: WHITE,
    primary: ensureContrastOn(withTone(seed, 80), surface, 4.5),
    onPrimary: withTone(seed, 20),
    primaryContainer: withTone(seed, 30),
    onPrimaryContainer: withTone(seed, 90),
  };
}

function lightRoles(base: Rgb, seed: Rgb): Roles {
  const surface = lightSurfaceOf(base);
  return {
    surface,
    ink: INK_DARK,
    primary: ensureContrastOn(withTone(seed, 40), surface, 4.5),
    onPrimary: WHITE,
    primaryContainer: withTone(seed, 90, 30),
    onPrimaryContainer: withTone(seed, 10),
  };
}

export function backdropColors(base: Rgb, accent: Rgb, light: boolean): BackdropColors {
  return light
    ? { ground: lightSurfaceOf(base), base: withTone(base, 90, 24), accent: withTone(accent, 82, 36) }
    : { ground: BLACK, base, accent };
}

/** Control roles from the app theme, kept readable on the player's surface. */
function appThemeControls(roles: Roles, app: ThemeColors): Roles {
  const primary = ensureContrastOn(parseHex(app.primary) ?? NEUTRAL_ACCENT, roles.surface, 3);
  const onPrimary = parseHex(app.onPrimary) ?? WHITE;
  return {
    ...roles,
    primary,
    onPrimary: contrastRatio(onPrimary, primary) >= 3 ? onPrimary : luminance(primary) > 0.4 ? INK_DARK : WHITE,
    primaryContainer: mix(roles.surface, primary, 0.3),
    onPrimaryContainer: roles.ink,
  };
}

/** White controls on a dark player, black on a light one; switched-on toggles fill solid. */
function monochromeControls(roles: Roles): Roles {
  const dark = luminance(roles.surface) < 0.5;
  const ink = dark ? WHITE : BLACK;
  const paper = dark ? BLACK : WHITE;
  return { ...roles, primary: ink, onPrimary: paper, primaryContainer: ink, onPrimaryContainer: paper };
}

export interface PlayerColorInput {
  swatches: ArtworkSwatches | null;
  style: PlayerBackgroundStyle;
  /** The app theme's colours for the variant the player is shown in. */
  app: ThemeColors;
  light: boolean;
  artworkControls: boolean;
  plainControls: PlainControlColors;
}

export interface PlayerColors {
  roles: Roles;
  backdrop: BackdropColors;
}

export function playerColors({ swatches, style, app, light, artworkControls, plainControls }: PlayerColorInput): PlayerColors {
  const appSurface = parseHex(app.background) ?? BLACK;
  const appInk = parseHex(app.onSurface) ?? WHITE;
  const appPrimary = parseHex(app.primary) ?? NEUTRAL_ACCENT;
  const base = swatches?.base ?? parseHex(app.surface) ?? appSurface;
  const seed = swatches?.accent ?? appPrimary;

  // Default follows the app theme entirely, as Android's DEFAULT style does.
  const playerRoles: Roles =
    style === "default"
      ? {
          surface: appSurface,
          ink: appInk,
          primary: ensureContrastOn(appPrimary, appSurface, 3),
          onPrimary: parseHex(app.onPrimary) ?? WHITE,
          primaryContainer: mix(appSurface, appPrimary, 0.3),
          onPrimaryContainer: appInk,
        }
      : light
        ? lightRoles(base, seed)
        : darkRoles(base, seed);

  const roles = artworkControls
    ? playerRoles
    : plainControls === "app_theme"
      ? appThemeControls(playerRoles, app)
      : monochromeControls(playerRoles);

  return {
    roles,
    backdrop: style === "default" ? { ground: appSurface, base: appSurface, accent: appSurface } : backdropColors(base, seed, light),
  };
}

/**
 * CSS variables for the player's root. `--color-primary` is overridden too, so
 * everything inside that already draws with the theme primary (the seek bar,
 * the play button) takes the player's control colour instead.
 */
export function playerCssVariables({ roles, backdrop }: PlayerColors): Record<string, string> {
  return {
    "--player-ground": css(backdrop.ground),
    "--player-base": css(backdrop.base),
    "--player-accent": css(backdrop.accent),
    "--player-surface": css(roles.surface),
    "--player-ink": css(roles.ink),
    "--player-primary": css(roles.primary),
    "--player-on-primary": css(roles.onPrimary),
    "--player-primary-container": css(roles.primaryContainer),
    "--player-on-primary-container": css(roles.onPrimaryContainer),
    "--color-primary": css(roles.primary),
    "--color-on-primary": css(roles.onPrimary),
    "--color-on-primary-val": css(roles.onPrimary),
  };
}

/**
 * A switched-on toggle on a surface the player does not own (the dock): the
 * artwork accent, or the plain choice, moved until it reads on that surface.
 */
export function toggleColorsOn(
  surface: Rgb,
  swatches: ArtworkSwatches | null,
  app: ThemeColors,
  artworkControls: boolean,
  plainControls: PlainControlColors,
): { color: string; backgroundColor: string } {
  const dark = luminance(surface) < 0.5;
  let foreground: Rgb;
  if (artworkControls && swatches?.accent) {
    foreground = ensureContrastOn(withTone(swatches.accent, dark ? 80 : 40), surface, 4.5);
  } else if (!artworkControls && plainControls === "monochrome") {
    foreground = dark ? WHITE : BLACK;
  } else {
    foreground = ensureContrastOn(parseHex(app.primary) ?? NEUTRAL_ACCENT, surface, 4.5);
  }
  return { color: css(foreground), backgroundColor: css(foreground, 0.16) };
}
