import { IS_MACOS_RUNTIME } from "./platform";
import type { KeyLike } from "./shortcuts/chord";
import { DIGIT_CHORDS, findShortcut, type ShortcutCommand } from "./shortcuts/command";

/**
 * The full player's keyboard map. Flow Android's `MediaKeyboardShortcuts` was
 * written from this set ("the keys Flow Desktop and YouTube use"), so both apps
 * answer the same keys.
 */
export type MusicPlayerKeyAction =
  | { kind: "toggle-play" }
  | { kind: "seek-by"; seconds: number }
  | { kind: "seek-to-fraction"; fraction: number }
  | { kind: "volume-by"; delta: number }
  | { kind: "toggle-mute" }
  | { kind: "next" }
  | { kind: "previous" }
  | { kind: "toggle-shuffle" }
  | { kind: "cycle-repeat" }
  | { kind: "toggle-queue" };

export const VOLUME_STEP = 0.05;

/** The action is built in two steps because the seek length is a setting, not part of the table. */
type MusicCommand = ShortcutCommand<(seekSeconds: number) => MusicPlayerKeyAction | null>;

const music = (
  id: string,
  label: MusicCommand["label"],
  keys: readonly string[],
  action: MusicCommand["action"],
  fixed?: boolean,
): MusicCommand => ({ id: `music.${id}`, scope: "music", label, keys, action, ...(fixed ? { fixed } : {}) });

export const MUSIC_COMMANDS: readonly MusicCommand[] = [
  music("play-pause", "keyboard_shortcut_play_pause", ["Space", "K"], () => () => ({ kind: "toggle-play" })),
  music("seek-back", "keyboard_shortcut_seek_back", ["ArrowLeft", "J"], () => (seconds) => ({ kind: "seek-by", seconds: -seconds })),
  music("seek-forward", "keyboard_shortcut_seek_forward", ["ArrowRight", "L"], () => (seconds) => ({ kind: "seek-by", seconds })),
  music("volume-up", "keyboard_shortcut_volume_up", ["ArrowUp"], () => () => ({ kind: "volume-by", delta: VOLUME_STEP })),
  music("volume-down", "keyboard_shortcut_volume_down", ["ArrowDown"], () => () => ({ kind: "volume-by", delta: -VOLUME_STEP })),
  music("mute", "keyboard_shortcut_mute", ["M"], () => () => ({ kind: "toggle-mute" })),
  music("next", "keyboard_shortcut_next", ["Shift+N"], () => () => ({ kind: "next" })),
  music("previous", "keyboard_shortcut_previous", ["Shift+P"], () => () => ({ kind: "previous" })),
  music("shuffle", "keyboard_shortcut_shuffle", ["S"], () => () => ({ kind: "toggle-shuffle" })),
  music("repeat", "keyboard_shortcut_repeat", ["R"], () => () => ({ kind: "cycle-repeat" })),
  music("queue", "keyboard_shortcut_queue", ["Q"], () => () => ({ kind: "toggle-queue" })),
  music(
    "seek-percent",
    "keyboard_shortcut_seek_percent",
    DIGIT_CHORDS,
    (key) => () => ({ kind: "seek-to-fraction", fraction: Number(key) / 10 }),
    true,
  ),
  // Escape is layered behind open menus, so useMusicPlayerKeyboard handles it on its own.
  music("close", "keyboard_shortcut_close_player", ["Escape"], () => () => null, true),
];

export function musicPlayerKeyAction(event: KeyLike, seekSeconds: number, isMac = IS_MACOS_RUNTIME): MusicPlayerKeyAction | null {
  return findShortcut(MUSIC_COMMANDS, event, isMac)?.action(seekSeconds) ?? null;
}

/** The volume after one wheel notch over a volume control: up is louder. */
export function volumeAfterWheel(volume: number, deltaY: number): number {
  if (deltaY === 0) return volume;
  const next = volume + (deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP);
  return Math.round(Math.min(1, Math.max(0, next)) * 100) / 100;
}
