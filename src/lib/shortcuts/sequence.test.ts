import { afterEach, describe, expect, it, vi } from "vitest";

import { APP_COMMANDS, appShortcut } from "./appCommands";
import { SEQUENCE_MS, awaitingSequence } from "./command";
import { conflictFor } from "./conflicts";
import { chordCaption } from "./format";
import { VIDEO_COMMANDS } from "../videoPlayerKeys";

const press = (key: string, extra: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) => ({ key, shiftKey: false, ...extra });

describe("go-to sequences", () => {
  afterEach(() => vi.useRealTimers());

  it("waits after G and goes on H", () => {
    expect(appShortcut(press("g"), false)).toBeNull();
    expect(awaitingSequence(APP_COMMANDS)).toBe(true);
    expect(appShortcut(press("h"), false)).toEqual({ kind: "go", path: "/" });
    expect(awaitingSequence(APP_COMMANDS)).toBe(false);
  });

  it("lets Shift go by while it waits", () => {
    appShortcut(press("g"), false);
    expect(appShortcut(press("Shift", { shiftKey: true }), false)).toBeNull();
    expect(appShortcut(press("s"), false)).toEqual({ kind: "go", path: "/subscriptions" });
  });

  it("gives up on a key that isn't part of a sequence", () => {
    appShortcut(press("g"), false);
    expect(appShortcut(press("q"), false)).toBeNull();
    expect(appShortcut(press("h"), false)).toBeNull();
  });

  it("forgets the G after a while", () => {
    vi.useFakeTimers();
    appShortcut(press("g"), false);
    vi.advanceTimersByTime(SEQUENCE_MS + 1);
    expect(awaitingSequence(APP_COMMANDS)).toBe(false);
    expect(appShortcut(press("h"), false)).toBeNull();
  });

  it("still answers single keys", () => {
    expect(appShortcut(press("/"), false)).toEqual({ kind: "search" });
    expect(appShortcut(press("r", { ctrlKey: true }), false)).toEqual({ kind: "refresh" });
    expect(appShortcut(press("F5"), false)).toEqual({ kind: "refresh" });
    expect(appShortcut(press(",", { metaKey: true }), true)).toEqual({ kind: "settings" });
  });

  it("reads as G then H", () => {
    expect(chordCaption("G H", false)).toBe("G then H");
  });

  it("counts a key that starts a sequence as taken", () => {
    const theater = VIDEO_COMMANDS.find((command) => command.id === "video.theater")!;
    expect(conflictFor(theater, "G", false, {})?.id).toMatch(/^app\.go-/);
  });
});
