import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const applied = vi.fn();
let currentVideo: { id: string } | null = null;

vi.mock("./musicKeyActions", () => ({ applyMusicKeyAction: (action: unknown) => applied(action) }));
vi.mock("../store/usePlayerStore", () => ({ usePlayerStore: { getState: () => ({ currentVideo }) } }));

import { useMusicDockKeyboard } from "./useMusicDockKeyboard";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ enabled }: { enabled: boolean }) {
  useMusicDockKeyboard(enabled);
  return null;
}

const press = (init: KeyboardEventInit, target: EventTarget = document.body) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

describe("useMusicDockKeyboard", () => {
  let root: Root;
  beforeEach(() => {
    applied.mockClear();
    currentVideo = null;
    root = createRoot(document.createElement("div"));
  });
  afterEach(() => act(() => root.unmount()));

  it("plays, mutes and skips with letter keys while the bar shows", () => {
    act(() => root.render(createElement(Probe, { enabled: true })));
    expect(press({ key: "k" }).defaultPrevented).toBe(true);
    press({ key: "N", shiftKey: true });
    expect(applied.mock.calls.map(([action]) => action)).toEqual([{ kind: "toggle-play" }, { kind: "next" }]);
  });

  it("leaves Space and the arrows to the page", () => {
    act(() => root.render(createElement(Probe, { enabled: true })));
    expect(press({ key: " " }).defaultPrevented).toBe(false);
    expect(press({ key: "ArrowDown" }).defaultPrevented).toBe(false);
    expect(applied).not.toHaveBeenCalled();
  });

  it("stays quiet while a video is loaded or the bar is hidden", () => {
    currentVideo = { id: "v" };
    act(() => root.render(createElement(Probe, { enabled: true })));
    press({ key: "k" });
    currentVideo = null;
    act(() => root.render(createElement(Probe, { enabled: false })));
    press({ key: "k" });
    expect(applied).not.toHaveBeenCalled();
  });
});
