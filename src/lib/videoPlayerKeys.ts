import { DIGIT_KEYS, type KeyBinding } from "./keyMap";

export type VideoPlayerKeyAction =
  | { kind: "toggle-play" }
  | { kind: "next" }
  | { kind: "previous" }
  | { kind: "seek-back" }
  | { kind: "seek-forward" }
  | { kind: "volume-up" }
  | { kind: "volume-down" }
  | { kind: "toggle-mute" }
  | { kind: "toggle-fullscreen" }
  | { kind: "exit-fullscreen" }
  | { kind: "toggle-theater" }
  | { kind: "toggle-pip" }
  | { kind: "toggle-captions" }
  | { kind: "captions-larger" }
  | { kind: "captions-smaller" }
  | { kind: "frame-back" }
  | { kind: "frame-forward" }
  | { kind: "slower" }
  | { kind: "faster" }
  | { kind: "previous-chapter" }
  | { kind: "next-chapter" }
  | { kind: "seek-start" }
  | { kind: "seek-end" }
  | { kind: "seek-to-fraction"; fraction: number };

export const VIDEO_KEY_BINDINGS: readonly KeyBinding<VideoPlayerKeyAction>[] = [
  { keys: [" ", "k"], label: "keyboard_shortcut_play_pause", action: () => ({ kind: "toggle-play" }) },
  { keys: ["n"], shift: true, label: "keyboard_shortcut_next", action: () => ({ kind: "next" }) },
  { keys: ["p"], shift: true, label: "keyboard_shortcut_previous", action: () => ({ kind: "previous" }) },
  { keys: ["arrowleft", "j"], label: "keyboard_shortcut_seek_back", action: () => ({ kind: "seek-back" }) },
  { keys: ["arrowright", "l"], label: "keyboard_shortcut_seek_forward", action: () => ({ kind: "seek-forward" }) },
  { keys: ["arrowup"], label: "keyboard_shortcut_volume_up", action: () => ({ kind: "volume-up" }) },
  { keys: ["arrowdown"], label: "keyboard_shortcut_volume_down", action: () => ({ kind: "volume-down" }) },
  { keys: ["m"], label: "keyboard_shortcut_mute", action: () => ({ kind: "toggle-mute" }) },
  { keys: ["f"], label: "keyboard_shortcut_fullscreen", action: () => ({ kind: "toggle-fullscreen" }) },
  { keys: ["escape"], label: "keyboard_shortcut_exit_fullscreen", action: () => ({ kind: "exit-fullscreen" }) },
  { keys: ["t"], label: "keyboard_shortcut_theater", action: () => ({ kind: "toggle-theater" }) },
  { keys: ["i"], label: "keyboard_shortcut_pip", action: () => ({ kind: "toggle-pip" }) },
  { keys: ["c"], label: "keyboard_shortcut_captions", action: () => ({ kind: "toggle-captions" }) },
  { keys: ["+", "="], label: "keyboard_shortcut_captions_larger", action: () => ({ kind: "captions-larger" }) },
  { keys: ["-"], label: "keyboard_shortcut_captions_smaller", action: () => ({ kind: "captions-smaller" }) },
  { keys: [","], label: "keyboard_shortcut_frame_back", action: () => ({ kind: "frame-back" }) },
  { keys: ["."], label: "keyboard_shortcut_frame_forward", action: () => ({ kind: "frame-forward" }) },
  { keys: ["<"], label: "keyboard_shortcut_slower", action: () => ({ kind: "slower" }) },
  { keys: [">"], label: "keyboard_shortcut_faster", action: () => ({ kind: "faster" }) },
  { keys: ["["], label: "keyboard_shortcut_previous_chapter", action: () => ({ kind: "previous-chapter" }) },
  { keys: ["]"], label: "keyboard_shortcut_next_chapter", action: () => ({ kind: "next-chapter" }) },
  { keys: ["home"], label: "keyboard_shortcut_seek_start", action: () => ({ kind: "seek-start" }) },
  { keys: ["end"], label: "keyboard_shortcut_seek_end", action: () => ({ kind: "seek-end" }) },
  {
    keys: DIGIT_KEYS,
    label: "keyboard_shortcut_seek_percent",
    action: (key) => ({ kind: "seek-to-fraction", fraction: Number(key) / 10 }),
  },
];

const BY_KEY = new Map(VIDEO_KEY_BINDINGS.flatMap((binding) => binding.keys.map((key) => [key, binding] as const)));

/** Shift is part of the character for `<`, `>` and `+`, so only a binding that asks for it looks at it. */
export function videoPlayerKeyAction(key: string, shiftKey = false): VideoPlayerKeyAction | null {
  const lower = key.toLowerCase();
  const binding = BY_KEY.get(lower);
  if (binding?.shift && !shiftKey) return null;
  return binding?.action(lower) ?? null;
}
