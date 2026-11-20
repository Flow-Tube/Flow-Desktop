import type { KeyLike } from "./chord";
import { findShortcut, type ShortcutCommand } from "./command";

export type AppShortcut =
  | { kind: "back" }
  | { kind: "forward" }
  | { kind: "search" }
  | { kind: "help" }
  | { kind: "settings" }
  | { kind: "side-rail" }
  | { kind: "refresh" }
  | { kind: "go"; path: string };

type AppCommand = ShortcutCommand<AppShortcut>;

const app = (
  id: string,
  label: AppCommand["label"],
  keys: readonly string[],
  action: AppCommand["action"],
  macKeys?: readonly string[],
): AppCommand => ({ id: `app.${id}`, scope: "app", label, keys, action, ...(macKeys ? { macKeys } : {}) });

const go = (id: string, label: AppCommand["label"], letter: string, path: string): AppCommand =>
  app(`go-${id}`, label, [`G ${letter}`], () => ({ kind: "go", path }));

/**
 * Keys that work anywhere in the app. Back and Forward used to be the webview's own, but its history
 * no longer moves now that every tab keeps a separate one. Mod+R and F5 refresh the page's content;
 * left to the webview they would reload the whole app and stop playback.
 */
export const APP_COMMANDS: readonly AppCommand[] = [
  app("search", "keyboard_shortcut_search", ["Mod+K", "/"], () => ({ kind: "search" }), ["Mod+K", "Ctrl+K", "/"]),
  app("back", "keyboard_shortcut_back", ["Alt+ArrowLeft"], () => ({ kind: "back" }), ["Alt+ArrowLeft", "Mod+["]),
  app("forward", "keyboard_shortcut_forward", ["Alt+ArrowRight"], () => ({ kind: "forward" }), ["Alt+ArrowRight", "Mod+]"]),
  app("refresh", "keyboard_shortcut_refresh", ["Mod+R", "F5"], () => ({ kind: "refresh" })),
  app("settings", "keyboard_shortcut_settings", ["Mod+,"], () => ({ kind: "settings" })),
  app("side-rail", "keyboard_shortcut_side_rail", ["Mod+B"], () => ({ kind: "side-rail" })),
  app("help", "keyboard_shortcut_help", ["?"], () => ({ kind: "help" })),
  go("home", "keyboard_shortcut_go_home", "H", "/"),
  go("subscriptions", "keyboard_shortcut_go_subscriptions", "S", "/subscriptions"),
  go("music", "keyboard_shortcut_go_music", "M", "/music"),
  go("explore", "keyboard_shortcut_go_explore", "E", "/explore"),
  go("shorts", "keyboard_shortcut_go_shorts", "O", "/shorts"),
  go("library", "keyboard_shortcut_go_library", "L", "/library"),
  go("history", "keyboard_shortcut_go_history", "Y", "/history"),
  go("watch-later", "keyboard_shortcut_go_watch_later", "W", "/watch-later"),
  go("playlists", "keyboard_shortcut_go_playlists", "P", "/playlists"),
  go("downloads", "keyboard_shortcut_go_downloads", "D", "/downloads"),
  go("notes", "keyboard_shortcut_go_notes", "N", "/notes"),
];

/** Call once per key press: the G of a go-to key waits here for its letter. */
export function appShortcut(event: KeyLike, isMac: boolean): AppShortcut | null {
  return findShortcut(APP_COMMANDS, event, isMac)?.action ?? null;
}
