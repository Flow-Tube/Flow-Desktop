import { IS_MACOS_RUNTIME } from "./platform";
import type { WatchCommand } from "./watchCommands";
import type { KeyLike } from "./shortcuts/chord";
import { DIGIT_CHORDS, findShortcut, type ShortcutCommand } from "./shortcuts/command";

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
  | { kind: "seek-to-fraction"; fraction: number }
  | { kind: "zoom-in" }
  | { kind: "zoom-out" }
  | { kind: "zoom-reset" }
  | { kind: "look"; key: string }
  | { kind: "toggle-loop" }
  | { kind: "next-resize" }
  | { kind: "save-frame" }
  | { kind: "copy-frame" }
  | { kind: "copy-link-at-time" }
  | { kind: "toggle-stats" }
  | { kind: "normal-speed" }
  | { kind: "toggle-chapters" }
  | { kind: "watch"; command: WatchCommand };

type VideoCommand = ShortcutCommand<VideoPlayerKeyAction>;

const video = (
  id: string,
  label: VideoCommand["label"],
  keys: readonly string[],
  action: VideoCommand["action"],
  fixed?: boolean,
): VideoCommand => ({ id: `video.${id}`, scope: "video", label, keys, action, ...(fixed ? { fixed } : {}) });

export const VIDEO_COMMANDS: readonly VideoCommand[] = [
  video("play-pause", "keyboard_shortcut_play_pause", ["Space", "K"], () => ({ kind: "toggle-play" })),
  video("next", "keyboard_shortcut_next", ["Shift+N"], () => ({ kind: "next" })),
  video("previous", "keyboard_shortcut_previous", ["Shift+P"], () => ({ kind: "previous" })),
  video("seek-back", "keyboard_shortcut_seek_back", ["ArrowLeft", "J"], () => ({ kind: "seek-back" })),
  video("seek-forward", "keyboard_shortcut_seek_forward", ["ArrowRight", "L"], () => ({ kind: "seek-forward" })),
  video("volume-up", "keyboard_shortcut_volume_up", ["ArrowUp"], () => ({ kind: "volume-up" })),
  video("volume-down", "keyboard_shortcut_volume_down", ["ArrowDown"], () => ({ kind: "volume-down" })),
  video("mute", "keyboard_shortcut_mute", ["M"], () => ({ kind: "toggle-mute" })),
  video("fullscreen", "keyboard_shortcut_fullscreen", ["F"], () => ({ kind: "toggle-fullscreen" })),
  // Menus take Escape first, so it can't move to another key.
  video("exit-fullscreen", "keyboard_shortcut_exit_fullscreen", ["Escape"], () => ({ kind: "exit-fullscreen" }), true),
  video("theater", "keyboard_shortcut_theater", ["T"], () => ({ kind: "toggle-theater" })),
  video("mini-player", "keyboard_shortcut_pip", ["I"], () => ({ kind: "toggle-pip" })),
  video("captions", "keyboard_shortcut_captions", ["C"], () => ({ kind: "toggle-captions" })),
  video("captions-larger", "keyboard_shortcut_captions_larger", ["Plus", "="], () => ({ kind: "captions-larger" })),
  video("captions-smaller", "keyboard_shortcut_captions_smaller", ["-"], () => ({ kind: "captions-smaller" })),
  video("frame-back", "keyboard_shortcut_frame_back", [","], () => ({ kind: "frame-back" })),
  video("frame-forward", "keyboard_shortcut_frame_forward", ["."], () => ({ kind: "frame-forward" })),
  video("slower", "keyboard_shortcut_slower", ["<"], () => ({ kind: "slower" })),
  video("faster", "keyboard_shortcut_faster", [">"], () => ({ kind: "faster" })),
  video("previous-chapter", "keyboard_shortcut_previous_chapter", ["["], () => ({ kind: "previous-chapter" })),
  video("next-chapter", "keyboard_shortcut_next_chapter", ["]"], () => ({ kind: "next-chapter" })),
  video("seek-start", "keyboard_shortcut_seek_start", ["Home"], () => ({ kind: "seek-start" })),
  video("seek-end", "keyboard_shortcut_seek_end", ["End"], () => ({ kind: "seek-end" })),
  video("zoom-in", "keyboard_shortcut_zoom_in", ["Z"], () => ({ kind: "zoom-in" })),
  video("zoom-out", "keyboard_shortcut_zoom_out", ["Shift+Z"], () => ({ kind: "zoom-out" })),
  video("zoom-reset", "keyboard_shortcut_zoom_reset", ["X"], () => ({ kind: "zoom-reset" })),
  video("look-up", "keyboard_shortcut_look_up", ["W"], () => ({ kind: "look", key: "w" })),
  video("look-left", "keyboard_shortcut_look_left", ["A"], () => ({ kind: "look", key: "a" })),
  video("look-down", "keyboard_shortcut_look_down", ["S"], () => ({ kind: "look", key: "s" })),
  video("look-right", "keyboard_shortcut_look_right", ["D"], () => ({ kind: "look", key: "d" })),
  video("loop", "keyboard_shortcut_loop", ["R"], () => ({ kind: "toggle-loop" })),
  video("next-resize", "keyboard_shortcut_next_resize", ["O"], () => ({ kind: "next-resize" })),
  video("save-frame", "keyboard_shortcut_save_frame", ["Shift+S"], () => ({ kind: "save-frame" })),
  video("stats", "keyboard_shortcut_stats", ["Shift+I"], () => ({ kind: "toggle-stats" })),
  video("like", "keyboard_shortcut_like", ["Shift+L"], () => ({ kind: "watch", command: "like" })),
  video("watch-later", "keyboard_shortcut_watch_later", ["Shift+W"], () => ({ kind: "watch", command: "watch-later" })),
  // Unbound until someone picks keys in Settings.
  video("copy-frame", "keyboard_shortcut_copy_frame", [], () => ({ kind: "copy-frame" })),
  video("copy-link-at-time", "keyboard_shortcut_copy_link_at_time", [], () => ({ kind: "copy-link-at-time" })),
  video("normal-speed", "keyboard_shortcut_normal_speed", [], () => ({ kind: "normal-speed" })),
  video("chapters", "keyboard_shortcut_chapters", [], () => ({ kind: "toggle-chapters" })),
  video("dislike", "keyboard_shortcut_dislike", [], () => ({ kind: "watch", command: "dislike" })),
  video("add-to-playlist", "keyboard_shortcut_add_to_playlist", [], () => ({ kind: "watch", command: "add-to-playlist" })),
  video(
    "seek-percent",
    "keyboard_shortcut_seek_percent",
    DIGIT_CHORDS,
    (key) => ({ kind: "seek-to-fraction", fraction: Number(key) / 10 }),
    true,
  ),
];

export function videoPlayerKeyAction(event: KeyLike, isMac = IS_MACOS_RUNTIME): VideoPlayerKeyAction | null {
  return findShortcut(VIDEO_COMMANDS, event, isMac)?.action ?? null;
}
