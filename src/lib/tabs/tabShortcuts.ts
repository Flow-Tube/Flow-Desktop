import type { HistoryKey } from "./historyShortcuts";

export type TabShortcut =
  | { kind: "new" }
  | { kind: "close" }
  | { kind: "cycle"; step: 1 | -1 }
  | { kind: "select"; position: number }
  | { kind: "select-last" };

/**
 * Browser tab keys. The primary modifier is Cmd on macOS and Ctrl elsewhere;
 * Ctrl+Tab cycles on every platform, as in browsers.
 */
export function tabShortcutForKey(event: HistoryKey, isMac: boolean): TabShortcut | null {
  if (event.altKey) return null;
  if (event.ctrlKey && !event.metaKey && event.key === "Tab") return { kind: "cycle", step: event.shiftKey ? -1 : 1 };

  const primary = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!primary || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  if (key === "t") return { kind: "new" };
  if (key === "w") return { kind: "close" };
  if (key === "9") return { kind: "select-last" };
  if (/^[1-8]$/.test(key)) return { kind: "select", position: Number(key) - 1 };
  return null;
}
