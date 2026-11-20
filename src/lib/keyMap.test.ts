import { describe, expect, it } from "vitest";

import { keyMapRows, shortcutKey } from "./keyMap";
import { MUSIC_KEY_BINDINGS, musicPlayerKeyAction } from "./musicPlayerKeys";
import { VIDEO_KEY_BINDINGS, videoPlayerKeyAction } from "./videoPlayerKeys";

const sources = import.meta.glob(["../components/player/Player.tsx", "./useMusicPlayerKeyboard.ts"], {
  query: "?raw",
  eager: true,
  import: "default",
}) as Record<string, string>;
const handler = (name: string) => Object.entries(sources).find(([file]) => file.endsWith(name))![1];

const unmodified = { altKey: false, ctrlKey: false, metaKey: false };

describe("video key map", () => {
  it("answers every key the help lists", () => {
    for (const binding of VIDEO_KEY_BINDINGS) {
      for (const key of binding.keys) {
        expect(videoPlayerKeyAction(key, !!binding.shift)).toEqual(binding.action(key));
      }
    }
  });

  it("only answers Shift+N and Shift+P with shift held", () => {
    expect(videoPlayerKeyAction("n")).toBeNull();
    expect(videoPlayerKeyAction("N", true)).toEqual({ kind: "next" });
    expect(videoPlayerKeyAction("P", true)).toEqual({ kind: "previous" });
  });

  it("has a handler in the player for every action", () => {
    const player = handler("Player.tsx");
    for (const binding of VIDEO_KEY_BINDINGS) {
      const { kind } = binding.action(binding.keys[0]!);
      expect(player).toContain(`case "${kind}":`);
    }
  });

  it("ignores case and leaves other keys alone", () => {
    expect(videoPlayerKeyAction("K")).toEqual({ kind: "toggle-play" });
    expect(videoPlayerKeyAction("ArrowLeft")).toEqual({ kind: "seek-back" });
    expect(videoPlayerKeyAction("7")).toEqual({ kind: "seek-to-fraction", fraction: 0.7 });
    expect(videoPlayerKeyAction("q")).toBeNull();
    expect(videoPlayerKeyAction("?")).toBeNull();
  });
});

describe("music key map", () => {
  it("answers every key the help lists, except Escape which its hook layers itself", () => {
    for (const binding of MUSIC_KEY_BINDINGS) {
      for (const key of binding.keys) {
        const action = musicPlayerKeyAction({ key, shiftKey: !!binding.shift, ...unmodified }, 10);
        if (key === "escape") expect(action).toBeNull();
        else expect(action).not.toBeNull();
      }
    }
  });

  it("has a handler in the hook for every action", () => {
    const hook = handler("useMusicPlayerKeyboard.ts");
    for (const binding of MUSIC_KEY_BINDINGS) {
      const action = binding.action(binding.keys[0]!)(10);
      if (action) expect(hook).toContain(`case "${action.kind}":`);
    }
  });

  it("only answers Shift+N and Shift+P with shift held", () => {
    expect(musicPlayerKeyAction({ key: "n", shiftKey: false, ...unmodified }, 10)).toBeNull();
    expect(musicPlayerKeyAction({ key: "k", shiftKey: true, ...unmodified }, 10)).toBeNull();
  });
});

describe("keyMapRows", () => {
  it("prints the keys people press", () => {
    const rows = keyMapRows(VIDEO_KEY_BINDINGS);
    expect(rows.find((row) => row.label === "Play or pause")?.caps).toEqual(["Space", "K"]);
    expect(rows.find((row) => row.label === "Back")?.caps).toEqual(["←", "J"]);
    expect(rows.find((row) => row.label === "Exit fullscreen")?.caps).toEqual(["Esc"]);
    expect(rows.find((row) => row.label === "Jump to 0% to 90%")?.caps).toEqual(["0 to 9"]);
  });

  it("names shift", () => {
    const rows = keyMapRows(MUSIC_KEY_BINDINGS);
    expect(rows.find((row) => row.label === "Next")?.caps).toEqual(["Shift + N"]);
  });
});

describe("shortcutKey", () => {
  it("keeps ASCII and named keys as they are", () => {
    expect(shortcutKey({ key: "K", code: "KeyK" })).toBe("k");
    expect(shortcutKey({ key: "ArrowLeft", code: "ArrowLeft" })).toBe("arrowleft");
    expect(shortcutKey({ key: "<", code: "Comma", shiftKey: true })).toBe("<");
  });

  it("reads letters of other scripts by where they sit", () => {
    expect(shortcutKey({ key: "ن", code: "KeyK" })).toBe("k");
    expect(shortcutKey({ key: "л", code: "KeyK" })).toBe("k");
    expect(shortcutKey({ key: "Ф", code: "KeyA", shiftKey: true })).toBe("a");
    expect(shortcutKey({ key: "لا", code: "KeyB" })).toBe("b");
    expect(shortcutKey({ key: "٤", code: "Digit4" })).toBe("4");
  });

  it("reads punctuation of other scripts on its US key", () => {
    expect(shortcutKey({ key: "х", code: "BracketLeft" })).toBe("[");
    expect(shortcutKey({ key: "Б", code: "Comma", shiftKey: true })).toBe("<");
  });

  it("leaves Latin layouts on their own letters", () => {
    expect(shortcutKey({ key: "a", code: "KeyQ" })).toBe("a");
  });

  it("drives the players on an Arabic layout", () => {
    expect(videoPlayerKeyAction(shortcutKey({ key: "ن", code: "KeyK" }))).toEqual({ kind: "toggle-play" });
    expect(
      musicPlayerKeyAction({ key: "ة", code: "KeyM", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }, 10),
    ).toEqual({ kind: "toggle-mute" });
  });
});
