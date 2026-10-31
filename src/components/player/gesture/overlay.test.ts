import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/clipboard", () => ({
  copyText: vi.fn(),
}));

vi.mock("../../../store/usePlayerStore", () => ({
  usePlayerStore: {
    getState: () => ({
      currentVideo: { id: "test-vid" },
    }),
  },
}));

import { PlayerGestureOverlay } from "./overlay";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

describe("PlayerGestureOverlay double-click vs single-click", () => {
  beforeEach(() => {
    HTMLDivElement.prototype.setPointerCapture = vi.fn();
    HTMLDivElement.prototype.releasePointerCapture = vi.fn();
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const renderOverlay = (overrides = {}) => {
    const props = {
      videoRef: { current: null },
      isPlaying: true,
      playbackRate: 1 as const,
      currentTime: 50,
      duration: 200,
      seekFeedback: null,
      volumeFeedback: null,
      seekIntervalSeconds: 10,
      longPressPlaybackRate: null,
      loopEnabled: false,
      setPlaybackRate: vi.fn(),
      onToggleLoop: vi.fn(),
      togglePlay: vi.fn(),
      toggleFullscreen: vi.fn(),
      togglePictureInPicture: vi.fn(),
      seekTo: vi.fn(),
      onSeekFeedback: vi.fn(),
      onRevealControls: vi.fn(),
      settingsOpen: false,
      onCloseSettings: vi.fn(),
      ...overrides,
    };

    act(() => {
      root.render(createElement(PlayerGestureOverlay, props));
    });

    const overlay = host.firstElementChild as HTMLDivElement;
    return { props, overlay };
  };

  it("triggers togglePlay on single click after delay", () => {
    const togglePlay = vi.fn();
    const { overlay } = renderOverlay({ togglePlay });

    act(() => {
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    });

    // Should not trigger synchronously
    expect(togglePlay).not.toHaveBeenCalled();

    // Advance timers past SINGLE_CLICK_DELAY_MS (220ms)
    act(() => {
      vi.advanceTimersByTime(230);
    });

    expect(togglePlay).toHaveBeenCalledTimes(1);
  });

  it("cancels togglePlay and seeks when double-clicking on the right side", () => {
    const togglePlay = vi.fn();
    const seekTo = vi.fn();
    const onSeekFeedback = vi.fn();
    const { overlay } = renderOverlay({ togglePlay, seekTo, onSeekFeedback, currentTime: 50, seekIntervalSeconds: 10 });

    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // First click of double-click (detail: 1)
    act(() => {
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 800, clientY: 300, detail: 1 }));
    });

    expect(togglePlay).not.toHaveBeenCalled();

    // Second click starts with pointerdown before delay expires (~100ms later)
    act(() => {
      vi.advanceTimersByTime(100);
      overlay.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 800, clientY: 300 }));
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 800, clientY: 300, detail: 2 }));
      overlay.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: 800, clientY: 300, detail: 2 }));
    });

    // Advance time past what would have been the single click delay
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // togglePlay must NOT have been called!
    expect(togglePlay).not.toHaveBeenCalled();

    // Seek forward must have been called
    expect(seekTo).toHaveBeenCalledWith(60);
    expect(onSeekFeedback).toHaveBeenCalledWith("forward", 10);
  });

  it("cancels togglePlay and seeks when double-clicking on the left side", () => {
    const togglePlay = vi.fn();
    const seekTo = vi.fn();
    const onSeekFeedback = vi.fn();
    const { overlay } = renderOverlay({ togglePlay, seekTo, onSeekFeedback, currentTime: 50, seekIntervalSeconds: 10 });

    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // First click
    act(() => {
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 200, clientY: 300, detail: 1 }));
    });

    // Second click + dblclick
    act(() => {
      vi.advanceTimersByTime(100);
      overlay.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 200, clientY: 300 }));
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 200, clientY: 300, detail: 2 }));
      overlay.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: 200, clientY: 300, detail: 2 }));
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    // No togglePlay!
    expect(togglePlay).not.toHaveBeenCalled();

    // Seek backward
    expect(seekTo).toHaveBeenCalledWith(40);
    expect(onSeekFeedback).toHaveBeenCalledWith("backward", 10);
  });
});
