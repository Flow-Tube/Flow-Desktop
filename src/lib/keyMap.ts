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
