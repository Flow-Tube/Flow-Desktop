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
