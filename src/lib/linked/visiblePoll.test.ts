import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pollWhileVisible } from "./visiblePoll";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("pollWhileVisible", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads at once and then once per interval", () => {
    const load = vi.fn();
    const stop = pollWhileVisible(load, 5000);
    vi.advanceTimersByTime(15_000);
    expect(load).toHaveBeenCalledTimes(4);
    stop();
  });

  it("stops while the window is hidden and loads again when it shows", () => {
    const load = vi.fn();
    const stop = pollWhileVisible(load, 5000);
    setVisibility("hidden");
    vi.advanceTimersByTime(60_000);
    expect(load).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops for good once stopped", () => {
    const load = vi.fn();
    pollWhileVisible(load, 5000)();
    setVisibility("hidden");
    setVisibility("visible");
    vi.advanceTimersByTime(60_000);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
