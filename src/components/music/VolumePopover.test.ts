import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { VolumePopover } from "./VolumePopover";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

describe("VolumePopover wheel volume control", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    useMusicPlayerStore.setState({
      volume: 0.5,
      isMuted: false,
      setVolume: vi.fn((v) => useMusicPlayerStore.setState({ volume: v })),
      toggleMute: vi.fn(() =>
        useMusicPlayerStore.setState((s) => ({ isMuted: !s.isMuted })),
      ),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("adjusts volume on wheel scroll up and down", () => {
    const setVolume = vi.fn();
    useMusicPlayerStore.setState({ setVolume, volume: 0.5, isMuted: false });

    act(() => {
      root.render(createElement(VolumePopover, { open: true }));
    });

    const popover = host.querySelector<HTMLDivElement>(".bg-surface-container");
    expect(popover).not.toBeNull();

    // Wheel up (negative deltaY) -> increase volume by 0.05
    act(() => {
      popover?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 }));
    });

    expect(setVolume).toHaveBeenCalledWith(0.55);

    // Wheel down (positive deltaY) -> decrease volume by 0.05
    act(() => {
      popover?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100 }));
    });

    expect(setVolume).toHaveBeenCalledWith(0.45);
  });

  it("unmutes when scrolling wheel up while muted", () => {
    const setVolume = vi.fn();
    const toggleMute = vi.fn();
    useMusicPlayerStore.setState({ setVolume, toggleMute, volume: 0.5, isMuted: true });

    act(() => {
      root.render(createElement(VolumePopover, { open: true }));
    });

    const popover = host.querySelector<HTMLDivElement>(".bg-surface-container");
    expect(popover).not.toBeNull();

    // Scrolling up from muted (shown = 0) -> 0.05 and unmute
    act(() => {
      popover?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 }));
    });

    expect(setVolume).toHaveBeenCalledWith(0.05);
    expect(toggleMute).toHaveBeenCalledTimes(1);
  });
});
