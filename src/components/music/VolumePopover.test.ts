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

describe("VolumePopover closing by itself", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    useMusicPlayerStore.setState({ volume: 0.5, isMuted: false });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  const openWith = (onClose: () => void) => {
    act(() => root.render(createElement(VolumePopover, { open: true, onClose })));
    return host.querySelector<HTMLElement>(".bg-surface-container")!;
  };
  const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  it("closes after 2.8 seconds untouched", () => {
    const onClose = vi.fn();
    openWith(onClose);

    wait(2799);
    expect(onClose).not.toHaveBeenCalled();
    wait(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open while the pointer is on it, then waits at least 1.5 seconds", () => {
    const onClose = vi.fn();
    const popover = openWith(onClose);

    wait(2000);
    act(() => popover.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    wait(10_000);
    expect(onClose).not.toHaveBeenCalled();

    act(() => popover.dispatchEvent(new PointerEvent("pointerout", { bubbles: true })));
    wait(1499);
    expect(onClose).not.toHaveBeenCalled();
    wait(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("starts counting again when the volume changes", () => {
    const onClose = vi.fn();
    openWith(onClose);

    wait(2000);
    act(() => useMusicPlayerStore.setState({ volume: 0.6 }));
    wait(2000);
    expect(onClose).not.toHaveBeenCalled();
    wait(800);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
