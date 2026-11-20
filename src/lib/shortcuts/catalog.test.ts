import { describe, expect, it } from "vitest";

import { MUSIC_COMMANDS, musicPlayerKeyAction } from "../musicPlayerKeys";
import { VIDEO_COMMANDS, videoPlayerKeyAction } from "../videoPlayerKeys";
import { SHORTCUT_GROUPS } from "./catalog";
import { parseChord, pressedChord, type KeyLike } from "./chord";
import { chordIds, commandKeys, findShortcut } from "./command";
import { chordCaption, shortcutRows } from "./format";

const sources = import.meta.glob(["../../components/player/Player.tsx", "../useMusicPlayerKeyboard.ts"], {
  query: "?raw",
  eager: true,
  import: "default",
}) as Record<string, string>;
const handler = (name: string) => Object.entries(sources).find(([file]) => file.endsWith(name))![1];

const KEY_EVENT_NAMES: Record<string, string> = { arrowleft: "ArrowLeft", arrowright: "ArrowRight", arrowup: "ArrowUp", arrowdown: "ArrowDown", escape: "Escape", home: "Home", end: "End", tab: "Tab" };

/** The keydown a person makes for `text`. */
function pressFor(text: string, isMac: boolean): KeyLike {
  const chord = pressedChord(parseChord(text)!, isMac);
  const key = KEY_EVENT_NAMES[chord.key] ?? (chord.shift && /^[a-z]$/.test(chord.key) ? chord.key.toUpperCase() : chord.key);
  return { key, shiftKey: chord.shift, ctrlKey: chord.ctrl, altKey: chord.alt, metaKey: chord.meta };
}

describe("shortcut catalog", () => {
  it.each([false, true])("answers every listed key with its own command (macOS %s)", (isMac) => {
    for (const group of SHORTCUT_GROUPS) {
      for (const command of group.commands) {
        for (const text of commandKeys(command, isMac)) {
          const [first, second] = text.split(" ");
          if (second) expect(findShortcut(group.commands, pressFor(first!, isMac), isMac), `${command.id} ${text}`).toBeNull();
          const match = findShortcut(group.commands, pressFor(second ?? first!, isMac), isMac);
          expect(match?.command.id, `${command.id} ${text}`).toBe(command.id);
        }
      }
    }
  });

  it("gives every command a unique id and every key one meaning per scope", () => {
    const ids = SHORTCUT_GROUPS.flatMap((group) => group.commands.map((command) => command.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const isMac of [false, true]) {
      for (const group of SHORTCUT_GROUPS) {
        const chords = group.commands.flatMap((command) => commandKeys(command, isMac).map((text) => chordIds(text, isMac)!.join(" ")));
        expect(new Set(chords).size, group.scope).toBe(chords.length);
      }
    }
  });

  it("has a handler in the player for every video action", () => {
    const player = handler("Player.tsx");
    for (const command of VIDEO_COMMANDS) {
      const { kind } = command.action(command.keys[0]!);
      expect(player).toContain(`case "${kind}":`);
    }
  });

  it("has a handler in the hook for every music action", () => {
    const hook = handler("useMusicPlayerKeyboard.ts");
    for (const command of MUSIC_COMMANDS) {
      const action = command.action(command.keys[0]!)(10);
      if (action) expect(hook).toContain(`case "${action.kind}":`);
    }
  });

  it("only answers Shift+N and Shift+P with shift held", () => {
    expect(videoPlayerKeyAction({ key: "n", shiftKey: false })).toBeNull();
    expect(musicPlayerKeyAction({ key: "n", shiftKey: false }, 10)).toBeNull();
    expect(musicPlayerKeyAction({ key: "K", shiftKey: true }, 10)).toBeNull();
  });
});

describe("shortcutRows", () => {
  it("prints the keys people press", () => {
    const rows = shortcutRows(VIDEO_COMMANDS, false);
    expect(rows.find((row) => row.label === "Play or pause")?.caps).toEqual(["Space", "K"]);
    expect(rows.find((row) => row.label === "Back")?.caps).toEqual(["←", "J"]);
    expect(rows.find((row) => row.label === "Exit fullscreen")?.caps).toEqual(["Esc"]);
    expect(rows.find((row) => row.label === "Jump to 0% to 90%")?.caps).toEqual(["0 to 9"]);
    expect(rows.find((row) => row.label === "Larger captions")?.caps).toEqual(["+", "="]);
  });

  it("names shift", () => {
    const rows = shortcutRows(MUSIC_COMMANDS, false);
    expect(rows.find((row) => row.label === "Next")?.caps).toEqual(["Shift + N"]);
  });

  it("writes modifiers the way each platform prints them", () => {
    expect(chordCaption("Mod+Shift+N", true)).toBe("⇧⌘N");
    expect(chordCaption("Mod+Shift+N", false)).toBe("Ctrl + Shift + N");
    expect(chordCaption("Ctrl+Tab", true)).toBe("⌃Tab");
    expect(chordCaption("Alt+ArrowLeft", false)).toBe("Alt + ←");
  });
});
