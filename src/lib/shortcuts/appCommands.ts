import type { KeyLike } from "./chord";
import { findShortcut, type ShortcutCommand } from "./command";

export type AppShortcut = { kind: "back" } | { kind: "forward" } | { kind: "search" } | { kind: "help" };

type AppCommand = ShortcutCommand<AppShortcut>;

const app = (
  id: string,
  label: AppCommand["label"],
  keys: readonly string[],
  action: AppCommand["action"],
  macKeys?: readonly string[],
): AppCommand => ({ id: `app.${id}`, scope: "app", label, keys, action, ...(macKeys ? { macKeys } : {}) });

/**
 * Keys that work anywhere in the app. Back and Forward used to be the webview's own, but its history
 * no longer moves now that every tab keeps a separate one.
 */
export const APP_COMMANDS: readonly AppCommand[] = [
  app("search", "keyboard_shortcut_search", ["Mod+K"], () => ({ kind: "search" }), ["Mod+K", "Ctrl+K"]),
  app("back", "keyboard_shortcut_back", ["Alt+ArrowLeft"], () => ({ kind: "back" }), ["Alt+ArrowLeft", "Mod+["]),
  app("forward", "keyboard_shortcut_forward", ["Alt+ArrowRight"], () => ({ kind: "forward" }), ["Alt+ArrowRight", "Mod+]"]),
  app("help", "keyboard_shortcut_help", ["?"], () => ({ kind: "help" })),
];

export function appShortcut(event: KeyLike, isMac: boolean): AppShortcut | null {
  return findShortcut(APP_COMMANDS, event, isMac)?.action ?? null;
}
