import { describe, expect, it } from "vitest";

import { musicPlayerKeyAction } from "../musicPlayerKeys";
import { videoPlayerKeyAction } from "../videoPlayerKeys";
import { shortcutKey } from "./eventKey";

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
    expect(videoPlayerKeyAction({ key: "ن", code: "KeyK", shiftKey: false })).toEqual({ kind: "toggle-play" });
    expect(
      musicPlayerKeyAction({ key: "ة", code: "KeyM", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }, 10),
    ).toEqual({ kind: "toggle-mute" });
  });
});
