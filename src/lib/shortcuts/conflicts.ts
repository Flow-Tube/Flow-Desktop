import type { ShortcutOverrides } from "./bindings";
import { SHORTCUT_GROUPS } from "./catalog";
import { chordId, parseChord, pressedChord } from "./chord";
import { chordIds, commandKeys, type ShortcutCommand, type ShortcutScope } from "./command";

/** The players sit on top of each other, and the one in front takes its keys first, so they may share keys. */
const LAYERED_SCOPES: ReadonlySet<ShortcutScope> = new Set(["video", "music", "shorts"]);

const pressedId = (text: string, isMac: boolean) => {
  const chord = parseChord(text);
  return chord ? chordId(pressedChord(chord, isMac)) : null;
};

/** Keys the system, text editing or focus need. */
const RESERVED_ANYWHERE = ["Escape", "Tab", "Shift+Tab", "Mod+C", "Mod+V", "Mod+X", "Mod+A", "Mod+Z", "Mod+Shift+Z"];
const RESERVED_MAC = ["Mod+Q", "Mod+H", "Mod+M", "Mod+`", "Mod+Alt+H"];
const RESERVED_OTHER = ["Alt+F4", "Alt+Tab", "Alt+Space"];
/** Outside a player, Space and Enter press the focused control. */
const RESERVED_OUTSIDE_PLAYERS = ["Space", "Enter"];

export function isReservedChord(text: string, scope: ShortcutScope, isMac: boolean): boolean {
  const id = pressedId(text, isMac);
  if (!id) return true;
  const reserved = [
    ...RESERVED_ANYWHERE,
    ...(isMac ? RESERVED_MAC : RESERVED_OTHER),
    ...(LAYERED_SCOPES.has(scope) ? [] : RESERVED_OUTSIDE_PLAYERS),
  ];
  return reserved.some((other) => pressedId(other, isMac) === id);
}

/** Two keys clash when they are the same, or when one is the first key of the other's sequence. */
function clashes(a: string[], b: string[]): boolean {
  if (a.join(" ") === b.join(" ")) return true;
  return (a.length === 1 && b.length === 2 && b[0] === a[0]) || (b.length === 1 && a.length === 2 && a[0] === b[0]);
}

/** The command that already answers `text` where `command` would, or null when the key is free. */
export function conflictFor(
  command: ShortcutCommand<unknown>,
  text: string,
  isMac: boolean,
  overrides: ShortcutOverrides,
): ShortcutCommand<unknown> | null {
  const ids = chordIds(text, isMac);
  if (!ids) return null;
  for (const group of SHORTCUT_GROUPS) {
    if (group.scope !== command.scope && LAYERED_SCOPES.has(group.scope) && LAYERED_SCOPES.has(command.scope)) continue;
    for (const other of group.commands) {
      if (other.id === command.id) continue;
      if (commandKeys(other, isMac, overrides).some((key) => {
        const otherIds = chordIds(key, isMac);
        return !!otherIds && clashes(ids, otherIds);
      })) return other;
    }
  }
  return null;
}
