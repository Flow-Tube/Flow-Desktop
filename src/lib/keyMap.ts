import { getString, type StringKey } from "./i18n/index";

/**
 * One line of a player's key map. The players read their keys from these tables and the help
 * lists print the same tables, so a key can't exist without showing up, or the other way round.
 */
export interface KeyBinding<Action> {
  /** `KeyboardEvent.key` values in lower case; the first one is what help shows first. */
  keys: readonly string[];
  shift?: boolean;
  label: StringKey;
  action: (key: string) => Action;
}

export interface KeyMapRow {
  label: string;
  caps: string[];
}

const NAMED_KEYS: Record<string, StringKey> = {
  " ": "keyboard_key_space",
  escape: "keyboard_key_escape",
  home: "keyboard_key_home",
  end: "keyboard_key_end",
};

const ARROWS: Record<string, string> = {
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
};

const DIGITS = "0123456789".split("");

function capFor(key: string, shift: boolean): string {
  const named = NAMED_KEYS[key];
  const face = named ? getString(named) : (ARROWS[key] ?? key.toUpperCase());
  return shift ? getString("keyboard_key_shift_plus", face) : face;
}

export function keyMapRows(bindings: readonly KeyBinding<unknown>[]): KeyMapRow[] {
  return bindings.map(({ keys, shift = false, label }) => ({
    label: getString(label),
    caps: keys.length === DIGITS.length && DIGITS.every((digit) => keys.includes(digit))
      ? [getString("keyboard_key_digits")]
      : keys.map((key) => capFor(key, shift)),
  }));
}

export const DIGIT_KEYS: readonly string[] = DIGITS;

/** Where a key sits on a US keyboard, unshifted and shifted, for keys that type punctuation there. */
const PUNCTUATION_BY_CODE: Record<string, readonly [string, string]> = {
  BracketLeft: ["[", "{"],
  BracketRight: ["]", "}"],
  Comma: [",", "<"],
  Period: [".", ">"],
  Slash: ["/", "?"],
  Semicolon: [";", ":"],
  Quote: ["'", '"'],
  Backquote: ["`", "~"],
  Minus: ["-", "_"],
  Equal: ["=", "+"],
  Backslash: ["\\", "|"],
};

export interface ShortcutKeyEvent {
  key: string;
  code?: string;
  shiftKey?: boolean;
}

/**
 * The key a shortcut table looks up, in lower case. On an Arabic, Persian, Russian or Greek layout
 * `key` is a letter of that script, so a key that types something outside ASCII is read by where it
 * sits instead, as YouTube does: K is still K. Latin layouts such as AZERTY keep their own letters.
 */
export function shortcutKey(event: ShortcutKeyEvent): string {
  const key = event.key.toLowerCase();
  // Named keys ("arrowleft", "escape") and ASCII characters are already what the tables hold.
  if (/^[\x20-\x7e]+$/.test(key) || !event.code) return key;
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
  if (letter) return letter.toLowerCase();
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(event.code)?.[1];
  if (digit) return digit;
  const punctuation = PUNCTUATION_BY_CODE[event.code];
  if (punctuation) return punctuation[event.shiftKey ? 1 : 0];
  return key;
}
