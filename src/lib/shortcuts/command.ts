import type { StringKey } from "../i18n/index";
import { currentShortcutSettings, NO_OVERRIDES, type ShortcutOverrides, type ShortcutSettings } from "./bindings";
import { chordId, eventChord, isModifierKey, parseChord, pressedChord, shiftIsPartOfKey, type Chord, type KeyLike } from "./chord";

export type ShortcutScope = "app" | "tabs" | "video" | "music" | "shorts";

/**
 * One thing a key can do. The players, the key list in help and Settings all read these tables, so
 * a key can't work without being listed, or be listed without working.
 */
export interface ShortcutCommand<Action> {
  id: string;
  scope: ShortcutScope;
  label: StringKey;
  /**
   * Chords as `parseChord` reads them; the first is the one shown first. Two chords with a space
   * between them are a sequence: "G H" is G, then H.
   */
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

/** How long the second key of a sequence may wait for the first. */
export const SEQUENCE_MS = 1200;
const SEQUENCE_START = "start:";

/** The ids of a key text's chords, one for a single chord and two for a sequence; null if it doesn't parse. */
export function chordIds(text: string, isMac: boolean): string[] | null {
  const ids: string[] = [];
  for (const part of text.trim().split(/\s+/)) {
    const chord = parseChord(part);
    if (!chord) return null;
    ids.push(chordId(pressedChord(chord, isMac)));
  }
  return ids.length > 0 && ids.length <= 2 ? ids : null;
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
        const ids = chordIds(text, isMac);
        const first = parseChord(text.trim().split(/\s+/)[0] ?? "");
        if (!ids || !first || (!settings.singleKeys && isSingleKey(first))) continue;
        built.set(ids.join(" "), command);
        if (ids.length === 2) built.set(SEQUENCE_START + ids[0], command);
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

const sequences = new WeakMap<readonly ShortcutCommand<unknown>[], { first: string; at: number }>();

/** True while `commands` waits for the second key of a sequence, such as the H after G. */
export function awaitingSequence(commands: readonly ShortcutCommand<unknown>[], now = Date.now()): boolean {
  const pending = sequences.get(commands);
  return !!pending && now - pending.at < SEQUENCE_MS;
}

/**
 * The command `event` presses in `commands`, with its modifiers matched exactly. A key that starts a
 * sequence matches nothing yet; the table then waits for the next key (see `awaitingSequence`). Call
 * it once per key press for a table with sequences, since it keeps that wait.
 */
export function findShortcut<Action>(
  commands: readonly ShortcutCommand<Action>[],
  event: KeyLike,
  isMac: boolean,
  settings: ShortcutSettings = currentShortcutSettings(),
): ShortcutMatch<Action> | null {
  if (recording || commands.length === 0) return null;
  // Shift held down on the way to `?` mustn't end a sequence that is waiting.
  if (isModifierKey(event.key)) return null;
  const byChord = index(commands, isMac, settings);
  const pressed = eventChord(event);
  const ids = [chordId(pressed)];
  if (pressed.shift && shiftIsPartOfKey(pressed.key)) ids.push(chordId({ ...pressed, shift: false }));
  const lookup = (prefix: string) => ids.map((id) => byChord.get(prefix + id)).find(Boolean);

  const pending = sequences.get(commands);
  sequences.delete(commands);
  if (pending && Date.now() - pending.at < SEQUENCE_MS) {
    const second = lookup(`${pending.first} `);
    if (second) return { command: second, action: second.action(pressed.key) };
  }
  const command = lookup("");
  if (command) return { command, action: command.action(pressed.key) };
  const startsSequence = ids.find((id) => byChord.has(SEQUENCE_START + id));
  if (startsSequence) sequences.set(commands, { first: startsSequence, at: Date.now() });
  return null;
}
