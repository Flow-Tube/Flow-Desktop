export interface HistoryKey {
  key: string;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

/**
 * Back/Forward from the keyboard: Alt+Left/Right everywhere, and Cmd+[ / Cmd+]
 * on macOS. The webview used to do this itself, but its own history no longer
 * moves now that every tab keeps a separate one.
 */
export function historyDeltaForKey(event: HistoryKey, isMac: boolean): -1 | 1 | null {
  if (event.shiftKey) return null;
  if (event.altKey && !event.metaKey && !event.ctrlKey) {
    if (event.key === "ArrowLeft") return -1;
    if (event.key === "ArrowRight") return 1;
  }
  if (isMac && event.metaKey && !event.altKey && !event.ctrlKey) {
    if (event.key === "[") return -1;
    if (event.key === "]") return 1;
  }
  return null;
}

/** Mouse side buttons: 3 is Back, 4 is Forward. */
export function historyDeltaForMouseButton(button: number): -1 | 1 | null {
  if (button === 3) return -1;
  if (button === 4) return 1;
  return null;
}
