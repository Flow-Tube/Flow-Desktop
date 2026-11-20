import type { StringKey } from "../i18n/index";
import { chordId, eventChord, parseChord, pressedChord, shiftIsPartOfKey, type KeyLike } from "./chord";

export type ShortcutScope = "app" | "tabs" | "video" | "music" | "shorts";

/**
 * One thing a key can do. The players, the key list in help and Settings all read these tables, so
 * a key can't work without being listed, or be listed without working.
 */
export interface ShortcutCommand<Action> {
  id: string;
  scope: ShortcutScope;
  label: StringKey;
  /** Chords as `parseChord` reads them; the first is the one shown first. */
  keys: readonly string[];
  /** Replaces `keys` on macOS. */
  macKeys?: readonly string[];
  /** Shown, but never rebound: Escape, which menus layer, and rows of keys such as the digits. */
  fixed?: boolean;
  /** `key` is the pressed key, for commands such as the digit row whose result depends on it. */
  action: (key: string) => Action;
}

export const DIGIT_CHORDS: readonly string[] = "0123456789".split("");

export function commandKeys(command: ShortcutCommand<unknown>, isMac: boolean): readonly string[] {
  return (isMac && command.macKeys) || command.keys;
}

type ChordIndex = Map<string, ShortcutCommand<unknown>>;
const indexes = new WeakMap<readonly ShortcutCommand<unknown>[], { mac?: ChordIndex; other?: ChordIndex }>();

function index<Action>(commands: readonly ShortcutCommand<Action>[], isMac: boolean): Map<string, ShortcutCommand<Action>> {
  const platforms = indexes.get(commands) ?? {};
  indexes.set(commands, platforms);
  const platform = isMac ? "mac" : "other";
  let built = platforms[platform];
  if (!built) {
    built = new Map();
    for (const command of commands) {
      for (const text of commandKeys(command, isMac)) {
        const chord = parseChord(text);
        if (chord) built.set(chordId(pressedChord(chord, isMac)), command);
      }
    }
    platforms[platform] = built;
  }
  return built as Map<string, ShortcutCommand<Action>>;
}

export interface ShortcutMatch<Action> {
  command: ShortcutCommand<Action>;
  action: Action;
}

/** The command `event` presses in `commands`, with its modifiers matched exactly. */
export function findShortcut<Action>(
  commands: readonly ShortcutCommand<Action>[],
  event: KeyLike,
  isMac: boolean,
): ShortcutMatch<Action> | null {
  if (commands.length === 0) return null;
  const byChord = index(commands, isMac);
  const pressed = eventChord(event);
  let command = byChord.get(chordId(pressed));
  if (!command && pressed.shift && shiftIsPartOfKey(pressed.key)) {
    command = byChord.get(chordId({ ...pressed, shift: false }));
  }
  return command ? { command, action: command.action(pressed.key) } : null;
}
