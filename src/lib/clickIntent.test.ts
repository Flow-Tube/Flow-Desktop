import { describe, expect, it } from "vitest";
import { wantsBackgroundTab } from "./clickIntent";

const click = (button: number, mods: Partial<{ ctrlKey: boolean; metaKey: boolean }> = {}) => ({
  button,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});

describe("wantsBackgroundTab", () => {
  it("takes middle-click on every platform", () => {
    expect(wantsBackgroundTab(click(1), true)).toBe(true);
    expect(wantsBackgroundTab(click(1), false)).toBe(true);
  });

  it("takes Cmd-click on macOS and Ctrl-click elsewhere", () => {
    expect(wantsBackgroundTab(click(0, { metaKey: true }), true)).toBe(true);
    expect(wantsBackgroundTab(click(0, { ctrlKey: true }), true)).toBe(false);
    expect(wantsBackgroundTab(click(0, { ctrlKey: true }), false)).toBe(true);
    expect(wantsBackgroundTab(click(0, { metaKey: true }), false)).toBe(false);
  });

  it("leaves plain and right clicks alone", () => {
    expect(wantsBackgroundTab(click(0), false)).toBe(false);
    expect(wantsBackgroundTab(click(2, { ctrlKey: true }), false)).toBe(false);
  });
});
