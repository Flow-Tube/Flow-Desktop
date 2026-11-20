import { IS_MACOS_RUNTIME } from "./platform";
import type { KeyLike } from "./shortcuts/chord";
import { DIGIT_CHORDS, findShortcut, type ShortcutCommand } from "./shortcuts/command";
import { keyBelongsToTarget } from "./shortcuts/target";
import type { WatchCommand } from "./watchCommands";

export type ShortsKeyAction =
  | { type: "page"; offset: 1 | -1 }
  | { type: "mute" }
  | { type: "toggle" }
  | { type: "seek"; direction: 1 | -1 }
  | { type: "jump"; tenths: number }
  | { type: "watch"; command: WatchCommand };

type ShortsCommand = ShortcutCommand<ShortsKeyAction>;

const shorts = (
  id: string,
  label: ShortsCommand["label"],
  keys: readonly string[],
  action: ShortsCommand["action"],
  fixed?: boolean,
): ShortsCommand => ({ id: `shorts.${id}`, scope: "shorts", label, keys, action, ...(fixed ? { fixed } : {}) });

/** Up and Down page between Shorts, as on the web, so the volume stays with the wheel and the slider. */
export const SHORTS_COMMANDS: readonly ShortsCommand[] = [
  shorts("next", "keyboard_shortcut_next", ["ArrowDown", "Shift+N"], () => ({ type: "page", offset: 1 })),
  shorts("previous", "keyboard_shortcut_previous", ["ArrowUp", "Shift+P"], () => ({ type: "page", offset: -1 })),
  shorts("play-pause", "keyboard_shortcut_play_pause", ["Space", "K"], () => ({ type: "toggle" })),
  shorts("mute", "keyboard_shortcut_mute", ["M"], () => ({ type: "mute" })),
  shorts("seek-back", "keyboard_shortcut_seek_back", ["ArrowLeft", "J"], () => ({ type: "seek", direction: -1 })),
  shorts("seek-forward", "keyboard_shortcut_seek_forward", ["ArrowRight", "L"], () => ({ type: "seek", direction: 1 })),
  shorts("like", "keyboard_shortcut_like", ["Shift+L"], () => ({ type: "watch", command: "like" })),
  shorts("comments", "keyboard_shortcut_comments", ["C"], () => ({ type: "watch", command: "comments" })),
  shorts("dislike", "keyboard_shortcut_dislike", [], () => ({ type: "watch", command: "dislike" })),
  shorts("seek-percent", "keyboard_shortcut_seek_percent", DIGIT_CHORDS, (key) => ({ type: "jump", tenths: Number(key) }), true),
];

export function shortsKeyAction(event: KeyLike, isMac = IS_MACOS_RUNTIME): ShortsKeyAction | null {
  return findShortcut(SHORTS_COMMANDS, event, isMac)?.action ?? null;
}

/**
 * Listens ahead of the video player's own keys, which would otherwise also reach a mini player
 * still running behind the Shorts page. Typing in a field and a focused control's own keys stay
 * with whatever has them, and a dialog on top of the page keeps them all. Focus may still be outside
 * a dialog, so the dialog check isn't on the key's target.
 */
export function listenForShortsKeys(handle: (action: ShortsKeyAction, event: KeyboardEvent) => boolean): () => void {
  const onKey = (event: KeyboardEvent) => {
    if (keyBelongsToTarget(event.target, event.key)) return;
    if (document.querySelector('[aria-modal="true"]:not([aria-hidden="true"])')) return;
    const action = shortsKeyAction(event);
    if (!action || !handle(action, event)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("keydown", onKey, { capture: true });
  return () => window.removeEventListener("keydown", onKey, { capture: true });
}
