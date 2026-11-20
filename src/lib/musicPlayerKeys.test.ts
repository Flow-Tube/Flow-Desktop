import { describe, expect, it } from "vitest";

import { musicPlayerKeyAction, volumeAfterWheel } from "./musicPlayerKeys";

const press = (key: string, extra: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
  musicPlayerKeyAction({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...extra }, 10);

describe("musicPlayerKeyAction", () => {
  it("maps the shared media keys", () => {
    expect(press(" ")).toEqual({ kind: "toggle-play" });
    expect(press("K")).toEqual({ kind: "toggle-play" });
    expect(press("j")).toEqual({ kind: "seek-by", seconds: -10 });
    expect(press("ArrowRight")).toEqual({ kind: "seek-by", seconds: 10 });
    expect(press("ArrowUp")).toEqual({ kind: "volume-by", delta: 0.05 });
    expect(press("N", { shiftKey: true })).toEqual({ kind: "next" });
    expect(press("P", { shiftKey: true })).toEqual({ kind: "previous" });
    expect(press("7")).toEqual({ kind: "seek-to-fraction", fraction: 0.7 });
  });

  it("likes with Shift+L and shows lyrics with Y", () => {
    expect(press("L", { shiftKey: true })).toEqual({ kind: "toggle-like" });
    expect(press("y")).toEqual({ kind: "toggle-lyrics" });
  });

  it("leaves shortcuts with modifiers to the system", () => {
    expect(press("k", { metaKey: true })).toBeNull();
    expect(press("q", { ctrlKey: true })).toBeNull();
    expect(press("x")).toBeNull();
  });

  it("turns the wheel into volume steps, clamped", () => {
    expect(volumeAfterWheel(0.5, -100)).toBe(0.55);
    expect(volumeAfterWheel(0.5, 100)).toBe(0.45);
    expect(volumeAfterWheel(0.98, -100)).toBe(1);
    expect(volumeAfterWheel(0.02, 100)).toBe(0);
  });
});
