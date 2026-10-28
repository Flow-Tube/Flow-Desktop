import { describe, expect, it } from "vitest";
import { tabShortcutForKey } from "./tabShortcuts";

const press = (key: string, mods: Partial<{ altKey: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) => ({
  key,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...mods,
});

describe("tabShortcutForKey", () => {
  it("uses Ctrl on Windows and Linux", () => {
    expect(tabShortcutForKey(press("t", { ctrlKey: true }), false)).toEqual({ kind: "new" });
    expect(tabShortcutForKey(press("W", { ctrlKey: true }), false)).toEqual({ kind: "close" });
    expect(tabShortcutForKey(press("3", { ctrlKey: true }), false)).toEqual({ kind: "select", position: 2 });
    expect(tabShortcutForKey(press("9", { ctrlKey: true }), false)).toEqual({ kind: "select-last" });
    expect(tabShortcutForKey(press("t", { metaKey: true }), false)).toBeNull();
  });

  it("uses Cmd on macOS", () => {
    expect(tabShortcutForKey(press("t", { metaKey: true }), true)).toEqual({ kind: "new" });
    expect(tabShortcutForKey(press("1", { metaKey: true }), true)).toEqual({ kind: "select", position: 0 });
    expect(tabShortcutForKey(press("t", { ctrlKey: true }), true)).toBeNull();
  });

  it("cycles with Ctrl+Tab everywhere", () => {
    expect(tabShortcutForKey(press("Tab", { ctrlKey: true }), true)).toEqual({ kind: "cycle", step: 1 });
    expect(tabShortcutForKey(press("Tab", { ctrlKey: true, shiftKey: true }), false)).toEqual({ kind: "cycle", step: -1 });
  });

  it("opens a window with Cmd+Shift+N on macOS and Ctrl+Shift+N elsewhere", () => {
    expect(tabShortcutForKey(press("N", { metaKey: true, shiftKey: true }), true)).toEqual({ kind: "new-window" });
    expect(tabShortcutForKey(press("n", { ctrlKey: true, shiftKey: true }), false)).toEqual({ kind: "new-window" });
    expect(tabShortcutForKey(press("n", { ctrlKey: true }), false)).toBeNull();
  });

  it("leaves other keys alone", () => {
    expect(tabShortcutForKey(press("t"), false)).toBeNull();
    expect(tabShortcutForKey(press("t", { ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(tabShortcutForKey(press("t", { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(tabShortcutForKey(press("0", { ctrlKey: true }), false)).toBeNull();
  });
});
