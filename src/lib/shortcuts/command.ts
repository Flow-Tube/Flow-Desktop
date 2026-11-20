import type { StringKey } from "../i18n/index";
import { currentShortcutSettings, NO_OVERRIDES, type ShortcutOverrides, type ShortcutSettings } from "./bindings";
import { chordId, eventChord, parseChord, pressedChord, shiftIsPartOfKey, type Chord, type KeyLike } from "./chord";

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

export function defaultKeys(command: ShortcutCommand<unknown>, isMac: boolean): readonly string[] {
  return (isMac && command.macKeys) || command.keys;
}

/** The keys a command answers: the person's own choice, or its defaults. */
export function commandKeys(
  command: ShortcutCommand<unknown>,
  isMac: boolean,
  overrides: ShortcutOverrides = NO_OVERRIDES,
): readonly string[] {
  return (!command.fixed && overrides[command.id]) || defaultKeys(command, isMac);
}

/** A key that types a character with no Ctrl, Alt or Cmd held: off when single-key shortcuts are. */
export const isSingleKey = (chord: Chord) =>
  !chord.mod && !chord.ctrl && !chord.alt && !chord.meta && chord.key.length === 1 && chord.key !== " ";

let recording = false;

/** While Settings records a new key, no shortcut acts on it. */
export function setShortcutRecording(on: boolean): void {
  recording = on;
}

type ChordIndex = Map<string, ShortcutCommand<unknown>>;
const indexes = new WeakMap<readonly ShortcutCommand<unknown>[], WeakMap<ShortcutSettings, Record<string, ChordIndex>>>();

function index<Action>(
  commands: readonly ShortcutCommand<Action>[],
  isMac: boolean,
  settings: ShortcutSettings,
): Map<string, ShortcutCommand<Action>> {
  const bySettings = indexes.get(commands) ?? new WeakMap<ShortcutSettings, Record<string, ChordIndex>>();
  indexes.set(commands, bySettings);
  const platforms = bySettings.get(settings) ?? {};
  bySettings.set(settings, platforms);
  const platform = isMac ? "mac" : "other";
  let built = platforms[platform];
  if (!built) {
    built = new Map();
    for (const command of commands) {
      for (const text of commandKeys(command, isMac, settings.overrides)) {
        const chord = parseChord(text);
        if (chord && (settings.singleKeys || !isSingleKey(chord))) built.set(chordId(pressedChord(chord, isMac)), command);
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
  settings: ShortcutSettings = currentShortcutSettings(),
): ShortcutMatch<Action> | null {
  if (recording || commands.length === 0) return null;
  const byChord = index(commands, isMac, settings);
  const pressed = eventChord(event);
  let command = byChord.get(chordId(pressed));
  if (!command && pressed.shift && shiftIsPartOfKey(pressed.key)) {
    command = byChord.get(chordId({ ...pressed, shift: false }));
  }
  return command ? { command, action: command.action(pressed.key) } : null;
}
