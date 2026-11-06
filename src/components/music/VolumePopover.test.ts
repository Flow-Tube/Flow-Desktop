import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { VolumePopover } from "./VolumePopover";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("VolumePopover wheel", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const wheelUp = () => {
    act(() => {
      host
        .querySelector(".bg-surface-container")!
        .dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 }));
    });
  };

  it("raises the volume", () => {
    const setVolume = vi.fn();
    useMusicPlayerStore.setState({ setVolume, volume: 0.5, isMuted: false });
    act(() => root.render(createElement(VolumePopover, { open: true })));

    wheelUp();

    expect(setVolume).toHaveBeenCalledWith(0.55);
  });

  it("unmutes to the saved level", () => {
    const setVolume = vi.fn();
    const toggleMute = vi.fn();
    useMusicPlayerStore.setState({ setVolume, toggleMute, volume: 0.5, isMuted: true });
    act(() => root.render(createElement(VolumePopover, { open: true })));

    wheelUp();

    expect(toggleMute).toHaveBeenCalledTimes(1);
    expect(setVolume).not.toHaveBeenCalled();
  });
});

describe("VolumePopover auto-dismissal", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("calls onClose after the inactivity delay", () => {
    const onClose = vi.fn();
    act(() => {
      root.render(createElement(VolumePopover, { open: true, onClose, autoDismissDelayMs: 2800 }));
    });

    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2800);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pauses auto-dismissal when hovered and resumes after pointer leaves", () => {
    const onClose = vi.fn();
    act(() => {
      root.render(createElement(VolumePopover, { open: true, onClose, autoDismissDelayMs: 2800 }));
    });

    const popover = host.querySelector(".bg-surface-container")!;

    // Hover before 2800ms elapses
    act(() => {
      vi.advanceTimersByTime(1500);
      popover.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });

    // Advance past 2800ms while hovered
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onClose).not.toHaveBeenCalled();

    // Pointer leaves: should trigger 1400ms resume delay
    act(() => {
      popover.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
    });

    act(() => {
      vi.advanceTimersByTime(1399);
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pauses auto-dismissal when focused inside", () => {
    const onClose = vi.fn();
    act(() => {
      root.render(createElement(VolumePopover, { open: true, onClose, autoDismissDelayMs: 2800 }));
    });

    const popover = host.querySelector(".bg-surface-container")!;
    const muteButton = popover.querySelector("button")!;

    act(() => {
      muteButton.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      muteButton.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
