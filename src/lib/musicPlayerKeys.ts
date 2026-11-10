import { DIGIT_KEYS, type KeyBinding } from "./keyMap";

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
type MusicKeyBinding = KeyBinding<(seekSeconds: number) => MusicPlayerKeyAction | null>;

interface KeyLike {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export const MUSIC_KEY_BINDINGS: readonly MusicKeyBinding[] = [
  { keys: [" ", "k"], label: "keyboard_shortcut_play_pause", action: () => () => ({ kind: "toggle-play" }) },
  {
    keys: ["arrowleft", "j"],
    label: "keyboard_shortcut_seek_back",
    action: () => (seekSeconds) => ({ kind: "seek-by", seconds: -seekSeconds }),
  },
  {
    keys: ["arrowright", "l"],
    label: "keyboard_shortcut_seek_forward",
    action: () => (seekSeconds) => ({ kind: "seek-by", seconds: seekSeconds }),
  },
  { keys: ["arrowup"], label: "keyboard_shortcut_volume_up", action: () => () => ({ kind: "volume-by", delta: VOLUME_STEP }) },
  { keys: ["arrowdown"], label: "keyboard_shortcut_volume_down", action: () => () => ({ kind: "volume-by", delta: -VOLUME_STEP }) },
  { keys: ["m"], label: "keyboard_shortcut_mute", action: () => () => ({ kind: "toggle-mute" }) },
  { keys: ["n"], shift: true, label: "keyboard_shortcut_next", action: () => () => ({ kind: "next" }) },
  { keys: ["p"], shift: true, label: "keyboard_shortcut_previous", action: () => () => ({ kind: "previous" }) },
  { keys: ["s"], label: "keyboard_shortcut_shuffle", action: () => () => ({ kind: "toggle-shuffle" }) },
  { keys: ["r"], label: "keyboard_shortcut_repeat", action: () => () => ({ kind: "cycle-repeat" }) },
  { keys: ["q"], label: "keyboard_shortcut_queue", action: () => () => ({ kind: "toggle-queue" }) },
  {
    keys: DIGIT_KEYS,
    label: "keyboard_shortcut_seek_percent",
    action: (key) => () => ({ kind: "seek-to-fraction", fraction: Number(key) / 10 }),
  },
  // Escape is layered behind open menus, so useMusicPlayerKeyboard handles it on its own.
  { keys: ["escape"], label: "keyboard_shortcut_close_player", action: () => () => null },
];

export function musicPlayerKeyAction(event: KeyLike, seekSeconds: number): MusicPlayerKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = event.key.toLowerCase();
  const binding = MUSIC_KEY_BINDINGS.find((entry) => entry.keys.includes(key) && !!entry.shift === event.shiftKey);
  return binding ? binding.action(key)(seekSeconds) : null;
}

/** Typing in a field, or a focused control that owns the key itself, keeps the key. */
export function keyBelongsToTarget(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  // A slider uses the arrows itself; a button uses Space.
  if (target.getAttribute("role") === "slider" && key.startsWith("Arrow")) return true;
  if ((tag === "BUTTON" || target.getAttribute("role") === "button") && (key === " " || key === "Enter")) return true;
  return false;
}

/** The volume after one wheel notch over a volume control: up is louder. */
export function volumeAfterWheel(volume: number, deltaY: number): number {
  if (deltaY === 0) return volume;
  const next = volume + (deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP);
  return Math.round(Math.min(1, Math.max(0, next)) * 100) / 100;
}
