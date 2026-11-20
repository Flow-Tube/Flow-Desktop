import { appShortcut } from "../shortcuts/appCommands";
import type { KeyLike } from "../shortcuts/chord";

/** Back/Forward from the keyboard: Alt+Left/Right everywhere, and Cmd+[ / Cmd+] on macOS. */
export function historyDeltaForKey(event: KeyLike, isMac: boolean): -1 | 1 | null {
  const shortcut = appShortcut(event, isMac);
  if (shortcut?.kind === "back") return -1;
  if (shortcut?.kind === "forward") return 1;
  return null;
}

/** Mouse side buttons: 3 is Back, 4 is Forward. */
export function historyDeltaForMouseButton(button: number): -1 | 1 | null {
  if (button === 3) return -1;
  if (button === 4) return 1;
  return null;
}
