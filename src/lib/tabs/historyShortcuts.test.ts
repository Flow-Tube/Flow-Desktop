import { describe, expect, it } from "vitest";
import { historyDeltaForKey, historyDeltaForMouseButton } from "./historyShortcuts";

const press = (key: string, mods: Partial<{ altKey: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) => ({
  key,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...mods,
});

describe("historyDeltaForKey", () => {
  it("maps Alt+Left and Alt+Right on every platform", () => {
    expect(historyDeltaForKey(press("ArrowLeft", { altKey: true }), false)).toBe(-1);
    expect(historyDeltaForKey(press("ArrowRight", { altKey: true }), true)).toBe(1);
  });

  it("maps Cmd+[ and Cmd+] only on macOS", () => {
    expect(historyDeltaForKey(press("[", { metaKey: true }), true)).toBe(-1);
    expect(historyDeltaForKey(press("]", { metaKey: true }), true)).toBe(1);
    expect(historyDeltaForKey(press("[", { metaKey: true }), false)).toBeNull();
  });

  it("ignores plain arrows and extra modifiers", () => {
    expect(historyDeltaForKey(press("ArrowLeft"), false)).toBeNull();
    expect(historyDeltaForKey(press("ArrowLeft", { altKey: true, shiftKey: true }), false)).toBeNull();
    expect(historyDeltaForKey(press("ArrowLeft", { altKey: true, ctrlKey: true }), false)).toBeNull();
  });
});

describe("historyDeltaForMouseButton", () => {
  it("maps the side buttons and nothing else", () => {
    expect(historyDeltaForMouseButton(3)).toBe(-1);
    expect(historyDeltaForMouseButton(4)).toBe(1);
    expect(historyDeltaForMouseButton(0)).toBeNull();
    expect(historyDeltaForMouseButton(1)).toBeNull();
  });
});
