import { getString, type StringKey } from "../i18n/index";
import { parseChord } from "./chord";
import { NO_OVERRIDES, type ShortcutOverrides } from "./bindings";
import { DIGIT_CHORDS, commandKeys, type ShortcutCommand } from "./command";

const NAMED_KEYS: Record<string, StringKey> = {
  " ": "keyboard_key_space",
  escape: "keyboard_key_escape",
  home: "keyboard_key_home",
  end: "keyboard_key_end",
};

const KEY_FACES: Record<string, string> = {
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  tab: "Tab",
  enter: "Enter",
  backspace: "Backspace",
  delete: "Delete",
  pageup: "Page Up",
  pagedown: "Page Down",
};

function keyFace(key: string): string {
  const named = NAMED_KEYS[key];
  if (named) return getString(named);
  return KEY_FACES[key] ?? key.toUpperCase();
}

/**
 * How a chord reads on this platform's keyboard: "⇧⌘N" on macOS, as in its menus, and
 * "Ctrl + Shift + N" elsewhere.
 */
export function chordCaption(text: string, isMac: boolean): string {
  const parts = text.trim().split(/\s+/);
  if (parts.length === 2) return getString("keyboard_key_then", chordCaption(parts[0]!, isMac), chordCaption(parts[1]!, isMac));
  const chord = parseChord(text);
  if (!chord) return text;
  const face = keyFace(chord.key);
  if (isMac) {
    const ctrl = chord.ctrl ? "⌃" : "";
    const alt = chord.alt ? "⌥" : "";
    const shift = chord.shift ? "⇧" : "";
    const command = chord.mod || chord.meta ? "⌘" : "";
    return `${ctrl}${alt}${shift}${command}${face}`;
  }
  let caption = chord.shift ? getString("keyboard_key_shift_plus", face) : face;
  if (chord.alt) caption = `Alt + ${caption}`;
  if (chord.meta) caption = `Win + ${caption}`;
  if (chord.ctrl || chord.mod) caption = `Ctrl + ${caption}`;
  return caption;
}

export interface ShortcutRow {
  id: string;
  label: string;
  caps: string[];
}

export const isDigitRow = (keys: readonly string[]) => keys.length === DIGIT_CHORDS.length && DIGIT_CHORDS.every((digit) => keys.includes(digit));

export function shortcutRows(
  commands: readonly ShortcutCommand<unknown>[],
  isMac: boolean,
  overrides: ShortcutOverrides = NO_OVERRIDES,
): ShortcutRow[] {
  return commands.map((command) => {
    const keys = commandKeys(command, isMac, overrides);
    return {
      id: command.id,
      label: getString(command.label),
      caps: isDigitRow(keys) ? [getString("keyboard_key_digits")] : keys.map((key) => chordCaption(key, isMac)),
    };
  });
}
