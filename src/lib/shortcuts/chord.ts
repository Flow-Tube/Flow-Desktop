import { shortcutKey, type ShortcutKeyEvent } from "./eventKey";

/**
 * A key combination as stored and shown: "Mod+Shift+T", "Ctrl+Tab", "Space", "?", "ArrowLeft".
 * `Mod` is Cmd on macOS and Ctrl elsewhere, so a saved shortcut means the same on both. `+` is
 * written `Plus` and the space bar `Space`, since `+` and a space separate the parts.
 */
export interface Chord {
  key: string;
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

/** A chord with `Mod` turned into the real modifier for this platform. */
export interface PressedChord {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export interface KeyLike extends ShortcutKeyEvent {
  shiftKey: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

const KEY_NAMES: Record<string, string> = { space: " ", plus: "+" };
const MODIFIERS = new Set(["mod", "ctrl", "alt", "shift", "meta"]);
const parsed = new Map<string, Chord | null>();

export function parseChord(text: string): Chord | null {
  const known = parsed.get(text);
  if (known !== undefined) return known;
  const parts = text.split("+").map((part) => part.trim().toLowerCase());
  const key = parts.pop();
  let chord: Chord | null = null;
  if (key && parts.every((part) => MODIFIERS.has(part))) {
    chord = {
      key: KEY_NAMES[key] ?? key,
      mod: parts.includes("mod"),
      ctrl: parts.includes("ctrl"),
      alt: parts.includes("alt"),
      shift: parts.includes("shift"),
      meta: parts.includes("meta"),
    };
  }
  parsed.set(text, chord);
  return chord;
}

export function pressedChord(chord: Chord, isMac: boolean): PressedChord {
  return {
    key: chord.key,
    ctrl: chord.ctrl || (chord.mod && !isMac),
    alt: chord.alt,
    shift: chord.shift,
    meta: chord.meta || (chord.mod && isMac),
  };
}

export function eventChord(event: KeyLike): PressedChord {
  return {
    key: shortcutKey(event),
    ctrl: !!event.ctrlKey,
    alt: !!event.altKey,
    shift: event.shiftKey,
    meta: !!event.metaKey,
  };
}

export const chordId = (chord: PressedChord) =>
  `${chord.ctrl ? "c" : ""}${chord.alt ? "a" : ""}${chord.shift ? "s" : ""}${chord.meta ? "m" : ""}:${chord.key}`;

/**
 * Shift is part of the character for `?`, `<`, `>` and `+`, so a chord for one of them matches with
 * or without it. For letters and named keys Shift is its own modifier: Shift+N isn't N.
 */
export const shiftIsPartOfKey = (key: string) => key.length === 1 && !/[a-z]/.test(key);
