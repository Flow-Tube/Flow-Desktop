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

/** The most buttons any width shows; a window has room for more than a phone's three. */
export const MAX_MINI_BAR_BUTTONS = 10;

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

/** The song's progress drawn on the Pill itself, besides the ring round its cover. */
export type MiniBarProgress = "none" | "fill" | "edge" | "line" | "wavy_line";
/** What clicking the Pill's cover does; the rest of the bar always opens the player. */
export type MiniCoverTap = "open" | "play_pause";
/** A small time figure before the Pill's buttons. Desktop's own. */
export type MiniBarTime = "off" | "elapsed" | "remaining";
/** How wide the Pill floats. Desktop's own. */
export type MiniBarWidth = "compact" | "regular" | "wide";

/** How many buttons each width has room for. */
const BUTTON_LIMITS: Record<MiniBarWidth, number> = { compact: 5, regular: 8, wide: 10 };

export const miniBarButtonLimit = (width: MiniBarWidth): number => BUTTON_LIMITS[width];

const PROGRESS: readonly MiniBarProgress[] = ["none", "fill", "edge", "line", "wavy_line"];
const COVER_TAPS: readonly MiniCoverTap[] = ["open", "play_pause"];
const TIMES: readonly MiniBarTime[] = ["off", "elapsed", "remaining"];
const WIDTHS: readonly MiniBarWidth[] = ["compact", "regular", "wide"];

export interface MiniPlayerLook {
  style: MiniPlayerStyle;
  background: MiniBarBackground;
  buttons: MiniBarButton[];
  coverRing: boolean;
  barProgress: MiniBarProgress;
  coverTap: MiniCoverTap;
  time: MiniBarTime;
  width: MiniBarWidth;
  /** The line being sung in place of the artist. */
  sungLine: boolean;
}

const oneOf = <T extends string>(value: string, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

export function useMiniPlayerLook(): MiniPlayerLook {
  const [style] = usePreference(SETTINGS.MUSIC_MINI_PLAYER_STYLE);
  const [background] = usePreference(SETTINGS.MINI_BAR_BACKGROUND);
  const [buttons] = usePreference(SETTINGS.MINI_BAR_BUTTONS);
  const [coverRing] = usePreference(SETTINGS.MINI_COVER_RING);
  const [barProgress] = usePreference(SETTINGS.MINI_BAR_PROGRESS);
  const [coverTap] = usePreference(SETTINGS.MINI_COVER_TAP);
  const [time] = usePreference(SETTINGS.MINI_BAR_TIME);
  const [width] = usePreference(SETTINGS.MINI_BAR_WIDTH);
  const [sungLine] = usePreference(SETTINGS.LYRICS_IN_MINI_PLAYER);
  const pillWidth = oneOf(width, WIDTHS, "regular");
  return {
    style: oneOf(style, STYLES, "pill"),
    background: oneOf(background, BACKGROUNDS, "tinted"),
    buttons: parseMiniBarButtons(buttons).slice(0, miniBarButtonLimit(pillWidth)),
    coverRing: coverRing !== "false",
    barProgress: oneOf(barProgress, PROGRESS, "none"),
    coverTap: oneOf(coverTap, COVER_TAPS, "open"),
    time: oneOf(time, TIMES, "off"),
    width: pillWidth,
    sungLine: sungLine === "true",
  };
}

/** What swiping the mini player sideways does. Device-wide, as on Android; Desktop starts at Nothing. */
export type MiniBarSwipeAction = "nothing" | "close" | "next" | "previous";
const SWIPE_ACTIONS: readonly MiniBarSwipeAction[] = ["nothing", "close", "next", "previous"];

export function parseSwipeAction(stored: string | undefined): MiniBarSwipeAction {
  return SWIPE_ACTIONS.includes(stored as MiniBarSwipeAction) ? (stored as MiniBarSwipeAction) : "nothing";
}

export const miniBarSwipeOptions = () => SWIPE_ACTIONS.map((value) => ({ value, label: getString(`mini_bar_swipe_${value}`) }));

export const miniBarProgressOptions = () => PROGRESS.map((value) => ({ value, label: getString(`mini_bar_progress_${value}`) }));
export const miniCoverTapOptions = () => COVER_TAPS.map((value) => ({ value, label: getString(`mini_cover_tap_${value}`) }));
export const miniBarTimeOptions = () => TIMES.map((value) => ({ value, label: getString(`mini_bar_time_${value}`) }));
export const miniBarWidthOptions = () => WIDTHS.map((value) => ({ value, label: getString(`mini_bar_width_${value}`) }));

export const miniPlayerStyleOptions = (): Array<{ value: MiniPlayerStyle; label: string }> =>
  STYLES.map((value) => ({ value, label: getString(`mini_player_style_${value}`) }));

export const miniBarBackgroundOptions = (): Array<{ value: MiniBarBackground; label: string }> =>
  BACKGROUNDS.map((value) => ({ value, label: getString(`mini_bar_background_${value}`) }));

export const miniBarButtonLabel = (button: MiniBarButton): string => getString(`mini_bar_button_${button}`);
