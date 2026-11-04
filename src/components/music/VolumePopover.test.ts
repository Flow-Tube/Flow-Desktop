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
