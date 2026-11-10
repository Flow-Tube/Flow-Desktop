// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { listenForShortsKeys, shortsKeyAction } from "./shortsKeys";

const key = (k: string, shiftKey = false) => ({ key: k, shiftKey });

describe("shortsKeyAction", () => {
  it("maps Android's keys", () => {
    expect(shortsKeyAction(key("ArrowDown"))).toEqual({ type: "page", offset: 1 });
    expect(shortsKeyAction(key("ArrowUp"))).toEqual({ type: "page", offset: -1 });
    expect(shortsKeyAction(key("N", true))).toEqual({ type: "page", offset: 1 });
    expect(shortsKeyAction(key("P", true))).toEqual({ type: "page", offset: -1 });
    expect(shortsKeyAction(key(" "))).toEqual({ type: "toggle" });
    expect(shortsKeyAction(key("k"))).toEqual({ type: "toggle" });
    expect(shortsKeyAction(key("m"))).toEqual({ type: "mute" });
    expect(shortsKeyAction(key("ArrowLeft"))).toEqual({ type: "seek", direction: -1 });
    expect(shortsKeyAction(key("l"))).toEqual({ type: "seek", direction: 1 });
    expect(shortsKeyAction(key("7"))).toEqual({ type: "jump", tenths: 7 });
    expect(shortsKeyAction(key("x"))).toBeNull();
    expect(shortsKeyAction(key("n"))).toBeNull();
  });
});

describe("listenForShortsKeys", () => {
  let stop = () => {};
  afterEach(() => {
    stop();
    document.body.replaceChildren();
  });

  const press = (init: KeyboardEventInit, target: EventTarget = document.body) => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };

  it("leaves every key to an open dialog, wherever focus is", () => {
    const handle = vi.fn(() => true);
    stop = listenForShortsKeys(handle);
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    expect(press({ key: "ArrowDown" }).defaultPrevented).toBe(false);
    expect(press({ key: "k" }, dialog).defaultPrevented).toBe(false);
    expect(handle).not.toHaveBeenCalled();
  });

  it("ignores a dialog that is hidden", () => {
    const handle = vi.fn(() => true);
    stop = listenForShortsKeys(handle);
    const closing = document.createElement("div");
    closing.setAttribute("aria-modal", "true");
    closing.setAttribute("aria-hidden", "true");
    document.body.append(closing);
    press({ key: "k" });
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("takes a handled key ahead of the player's own listener", () => {
    const player = vi.fn();
    window.addEventListener("keydown", player);
    stop = listenForShortsKeys(() => true);
    const event = press({ key: "ArrowDown" });
    expect(event.defaultPrevented).toBe(true);
    expect(player).not.toHaveBeenCalled();
    window.removeEventListener("keydown", player);
  });

  it("lets a key through when the handler passes on it", () => {
    stop = listenForShortsKeys(() => false);
    expect(press({ key: "ArrowDown" }).defaultPrevented).toBe(false);
  });

  it("leaves typing and held modifiers alone", () => {
    const handle = vi.fn(() => true);
    stop = listenForShortsKeys(handle);
    const input = document.createElement("textarea");
    document.body.append(input);
    press({ key: "m" }, input);
    press({ key: "m", ctrlKey: true });
    expect(handle).not.toHaveBeenCalled();
    input.remove();
  });
});
