import { getString } from "../i18n/index";
import { SETTINGS } from "../settings/schema";
import { usePreference } from "../usePreference";

/** The music mini player's shape: a compact pill, or the wide bar Flow Desktop always had. */
export type MiniPlayerStyle = "pill" | "classic";

/** The mini player's paint: the cover's tone on a quiet container, or one of the other looks. */
export type MiniBarBackground = "tinted" | "vivid" | "app_theme" | "cover_colors" | "black" | "outlined";

/** A button the pill can show, in the user's order. Volume, Equalizer and Play on are Desktop's own. */
export type MiniBarButton =
  | "previous"
  | "play_pause"
  | "next"
  | "like"
  | "add_to_playlist"
  | "shuffle"
  | "repeat"
  | "queue"
  | "lyrics"
  | "sleep_timer"
  | "back_10"
  | "forward_10"
  | "volume"
  | "equalizer"
  | "play_on"
  | "close";

export const MINI_BAR_BUTTONS: readonly MiniBarButton[] = [
  "previous",
  "play_pause",
  "next",
  "like",
  "add_to_playlist",
  "shuffle",
  "repeat",
  "queue",
  "lyrics",
  "sleep_timer",
  "back_10",
  "forward_10",
  "volume",
  "equalizer",
  "play_on",
  "close",
];

/** A window has room for more than a phone's three. */
export const MAX_MINI_BAR_BUTTONS = 6;

export const DEFAULT_MINI_BAR_BUTTONS: readonly MiniBarButton[] = ["previous", "play_pause", "next", "lyrics", "queue"];

const STYLES: readonly MiniPlayerStyle[] = ["pill", "classic"];
const BACKGROUNDS: readonly MiniBarBackground[] = ["tinted", "vivid", "app_theme", "cover_colors", "black", "outlined"];

/** Stored button names back as buttons: unknown names skipped, at most six; nothing stored means the defaults. */
export function parseMiniBarButtons(stored: string): MiniBarButton[] {
  if (!stored.trim()) return [...DEFAULT_MINI_BAR_BUTTONS];
  const known = new Set<string>(MINI_BAR_BUTTONS);
  const buttons = [...new Set(stored.split(","))].filter((name): name is MiniBarButton => known.has(name));
  return buttons.slice(0, MAX_MINI_BAR_BUTTONS);
}

export function serializeMiniBarButtons(buttons: readonly MiniBarButton[]): string {
  return buttons.slice(0, MAX_MINI_BAR_BUTTONS).join(",");
}

export interface MiniPlayerLook {
  style: MiniPlayerStyle;
  background: MiniBarBackground;
  buttons: MiniBarButton[];
}

export function useMiniPlayerLook(): MiniPlayerLook {
  const [style] = usePreference(SETTINGS.MUSIC_MINI_PLAYER_STYLE);
  const [background] = usePreference(SETTINGS.MINI_BAR_BACKGROUND);
  const [buttons] = usePreference(SETTINGS.MINI_BAR_BUTTONS);
  return {
    style: STYLES.includes(style as MiniPlayerStyle) ? (style as MiniPlayerStyle) : "pill",
    background: BACKGROUNDS.includes(background as MiniBarBackground) ? (background as MiniBarBackground) : "tinted",
    buttons: parseMiniBarButtons(buttons),
  };
}

export const miniPlayerStyleOptions = (): Array<{ value: MiniPlayerStyle; label: string }> =>
  STYLES.map((value) => ({ value, label: getString(`mini_player_style_${value}`) }));

export const miniBarBackgroundOptions = (): Array<{ value: MiniBarBackground; label: string }> =>
  BACKGROUNDS.map((value) => ({ value, label: getString(`mini_bar_background_${value}`) }));

export const miniBarButtonLabel = (button: MiniBarButton): string => getString(`mini_bar_button_${button}`);
