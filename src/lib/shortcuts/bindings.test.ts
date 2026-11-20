import { afterEach, describe, expect, it } from "vitest";

import { TAB_COMMANDS } from "../tabs/tabShortcuts";
import { VIDEO_COMMANDS } from "../videoPlayerKeys";
import { NO_OVERRIDES, parseOverrides, withCommandKeys, type ShortcutSettings } from "./bindings";
import { chordFromEvent } from "./chord";
import { findShortcut, setShortcutRecording } from "./command";
import { conflictFor, isReservedChord } from "./conflicts";

const press = (key: string, mods: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; code?: string } = {}) => ({
  key,
  shiftKey: false,
  ...mods,
});
const settings = (overrides: Record<string, string[]>, singleKeys = true): ShortcutSettings => ({ overrides, singleKeys });
const videoCommand = (id: string) => VIDEO_COMMANDS.find((command) => command.id === id)!;

describe("parseOverrides", () => {
  it("keeps lists of chords and drops anything else", () => {
    expect(parseOverrides('{"video.mute":["Shift+M"],"video.theater":[],"bad":["Mod+Nope+X"],"worse":3}')).toEqual({
      "video.mute": ["Shift+M"],
      "video.theater": [],
    });
    expect(parseOverrides("not json")).toBe(NO_OVERRIDES);
    expect(parseOverrides(undefined)).toBe(NO_OVERRIDES);
  });

  it("puts a command back to its defaults with null", () => {
    expect(withCommandKeys({ "video.mute": ["Q"] }, "video.mute", null)).toEqual({});
  });
});

describe("findShortcut with a person's keys", () => {
  afterEach(() => setShortcutRecording(false));

  it("answers the new key and forgets the old one", () => {
    const mine = settings({ "video.mute": ["Shift+M"] });
    expect(findShortcut(VIDEO_COMMANDS, press("M", { shiftKey: true }), false, mine)?.command.id).toBe("video.mute");
    expect(findShortcut(VIDEO_COMMANDS, press("m"), false, mine)).toBeNull();
  });

  it("leaves a command with no keys unbound", () => {
    expect(findShortcut(VIDEO_COMMANDS, press("t"), false, settings({ "video.theater": [] }))).toBeNull();
  });

  it("never moves a fixed command", () => {
    const mine = settings({ "video.exit-fullscreen": ["Q"] });
    expect(findShortcut(VIDEO_COMMANDS, press("Escape"), false, mine)?.command.id).toBe("video.exit-fullscreen");
  });

  it("can bind a player command to a key with Ctrl", () => {
    const mine = settings({ "video.next-chapter": ["Mod+ArrowRight"] });
    expect(findShortcut(VIDEO_COMMANDS, press("ArrowRight", { ctrlKey: true }), false, mine)?.command.id).toBe("video.next-chapter");
    expect(findShortcut(VIDEO_COMMANDS, press("ArrowRight", { metaKey: true }), true, mine)?.command.id).toBe("video.next-chapter");
  });

  it("turns off keys that type a character on their own", () => {
    const off = settings({}, false);
    expect(findShortcut(VIDEO_COMMANDS, press("k"), false, off)).toBeNull();
    expect(findShortcut(VIDEO_COMMANDS, press("7"), false, off)).toBeNull();
    expect(findShortcut(VIDEO_COMMANDS, press(" "), false, off)?.command.id).toBe("video.play-pause");
    expect(findShortcut(VIDEO_COMMANDS, press("ArrowLeft"), false, off)?.command.id).toBe("video.seek-back");
    expect(findShortcut(TAB_COMMANDS, press("t", { ctrlKey: true }), false, off)?.command.id).toBe("tabs.new");
  });

  it("does nothing while Settings records a key", () => {
    setShortcutRecording(true);
    expect(findShortcut(VIDEO_COMMANDS, press("k"), false, settings({}))).toBeNull();
  });
});

describe("chordFromEvent", () => {
  it("writes Cmd on macOS and Ctrl elsewhere as Mod", () => {
    expect(chordFromEvent(press("t", { metaKey: true }), true)).toBe("Mod+T");
    expect(chordFromEvent(press("t", { ctrlKey: true }), false)).toBe("Mod+T");
    expect(chordFromEvent(press("Tab", { ctrlKey: true }), true)).toBe("Ctrl+Tab");
  });

  it("keeps Shift only where it isn't part of the character", () => {
    expect(chordFromEvent(press("N", { shiftKey: true }), false)).toBe("Shift+N");
    expect(chordFromEvent(press("?", { shiftKey: true }), false)).toBe("?");
    expect(chordFromEvent(press("ArrowLeft", { shiftKey: true }), false)).toBe("Shift+ArrowLeft");
  });

  it("names the space bar and plus, and waits past bare modifiers", () => {
    expect(chordFromEvent(press(" "), false)).toBe("Space");
    expect(chordFromEvent(press("+", { shiftKey: true }), false)).toBe("Plus");
    expect(chordFromEvent(press("Shift", { shiftKey: true }), false)).toBeNull();
  });

  it("reads a key by its place on a non-Latin layout", () => {
    expect(chordFromEvent(press("ن", { code: "KeyK" }), false)).toBe("K");
  });
});

describe("conflicts", () => {
  it("finds the command already on a key", () => {
    expect(conflictFor(videoCommand("video.theater"), "M", false, {})?.id).toBe("video.mute");
    expect(conflictFor(videoCommand("video.theater"), "Mod+T", false, {})?.id).toBe("tabs.new");
    expect(conflictFor(videoCommand("video.theater"), "U", false, {})).toBeNull();
  });

  it("lets the players share keys, since the one in front takes them", () => {
    expect(conflictFor(videoCommand("video.theater"), "Q", false, {})).toBeNull();
  });

  it("counts a person's own keys", () => {
    expect(conflictFor(videoCommand("video.theater"), "U", false, { "video.mute": ["U"] })?.id).toBe("video.mute");
    expect(conflictFor(videoCommand("video.theater"), "M", false, { "video.mute": ["U"] })).toBeNull();
  });

  it("keeps system and typing keys", () => {
    expect(isReservedChord("Mod+Q", "video", true)).toBe(true);
    expect(isReservedChord("Mod+C", "app", false)).toBe(true);
    expect(isReservedChord("Space", "app", false)).toBe(true);
    expect(isReservedChord("Space", "video", false)).toBe(false);
    expect(isReservedChord("Mod+Q", "video", false)).toBe(false);
  });
});
