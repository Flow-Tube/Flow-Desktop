import type { KeyLike } from "../shortcuts/chord";
import { findShortcut, type ShortcutCommand } from "../shortcuts/command";

export type TabShortcut =
  | { kind: "new" }
  | { kind: "new-window" }
  | { kind: "close" }
  | { kind: "cycle"; step: 1 | -1 }
  | { kind: "select"; position: number }
  | { kind: "select-last" };

type TabCommand = ShortcutCommand<TabShortcut>;

const tab = (
  id: string,
  label: TabCommand["label"],
  keys: readonly string[],
  action: TabCommand["action"],
  fixed?: boolean,
): TabCommand => ({ id: `tabs.${id}`, scope: "tabs", label, keys, action, ...(fixed ? { fixed } : {}) });

/** Browser tab and window keys. Mod is Cmd on macOS and Ctrl elsewhere; Ctrl+Tab cycles everywhere, as in browsers. */
export const TAB_COMMANDS: readonly TabCommand[] = [
  tab("new", "keyboard_shortcut_tab_new", ["Mod+T"], () => ({ kind: "new" })),
  tab("new-window", "keyboard_shortcut_new_window", ["Mod+Shift+N"], () => ({ kind: "new-window" })),
  tab("close", "keyboard_shortcut_tab_close", ["Mod+W"], () => ({ kind: "close" })),
  tab("next", "keyboard_shortcut_tab_next", ["Ctrl+Tab"], () => ({ kind: "cycle", step: 1 })),
  tab("previous", "keyboard_shortcut_tab_previous", ["Ctrl+Shift+Tab"], () => ({ kind: "cycle", step: -1 })),
  tab(
    "select",
    "keyboard_shortcut_tab_select",
    ["Mod+1", "Mod+2", "Mod+3", "Mod+4", "Mod+5", "Mod+6", "Mod+7", "Mod+8"],
    (key) => ({ kind: "select", position: Number(key) - 1 }),
    true,
  ),
  tab("select-last", "keyboard_shortcut_tab_select_last", ["Mod+9"], () => ({ kind: "select-last" })),
];

export function tabShortcutForKey(event: KeyLike, isMac: boolean, tabsOn: boolean): TabShortcut | null {
  const shortcut = findShortcut(TAB_COMMANDS, event, isMac)?.action ?? null;
  // With tabs off, Cmd+W and the rest keep their usual meaning; only the new-window key stays.
  return tabsOn || shortcut?.kind === "new-window" ? shortcut : null;
}
