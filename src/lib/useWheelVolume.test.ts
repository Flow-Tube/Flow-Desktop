import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWheelVolume } from "./useWheelVolume";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function TestComponent(props: {
  volume: number;
  muted: boolean;
  onVolumeChange: (vol: number) => void;
  onMuteChange?: (muted: boolean) => void;
}) {
  const ref = useWheelVolume(props);
  return createElement("div", { ref, "data-testid": "volume-box" });
}

describe("useWheelVolume", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("prevents default scroll and adjusts volume up on wheel up", () => {
    const onVolumeChange = vi.fn();
    const onMuteChange = vi.fn();

    act(() => {
      root.render(
        createElement(TestComponent, {
          volume: 0.5,
          muted: false,
          onVolumeChange,
          onMuteChange,
        }),
      );
    });

    const el = host.querySelector<HTMLDivElement>('[data-testid="volume-box"]');
    expect(el).not.toBeNull();

    const wheelEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
    });

    act(() => {
      el?.dispatchEvent(wheelEvent);
    });

    // Native scroll must be prevented to avoid snapping to next Short/scrolling page
    expect(wheelEvent.defaultPrevented).toBe(true);
    expect(onVolumeChange).toHaveBeenCalledWith(0.55);
  });

  it("unmutes when scrolling wheel up while muted", () => {
    const onVolumeChange = vi.fn();
    const onMuteChange = vi.fn();

    act(() => {
      root.render(
        createElement(TestComponent, {
          volume: 0.5,
          muted: true,
          onVolumeChange,
          onMuteChange,
        }),
      );
    });

    const el = host.querySelector<HTMLDivElement>('[data-testid="volume-box"]');
    const wheelEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
    });

    act(() => {
      el?.dispatchEvent(wheelEvent);
    });

    expect(wheelEvent.defaultPrevented).toBe(true);
    expect(onVolumeChange).toHaveBeenCalledWith(0.05);
    expect(onMuteChange).toHaveBeenCalledWith(false);
  });

  it("attaches properly when conditionally mounted later", () => {
    const onVolumeChange = vi.fn();

    function ConditionalComponent(props: { active: boolean }) {
      const ref = useWheelVolume({
        volume: 0.8,
        muted: false,
        onVolumeChange,
      });
      return props.active ? createElement("div", { ref, "data-testid": "delayed-box" }) : null;
    }

    act(() => {
      root.render(createElement(ConditionalComponent, { active: false }));
    });

    expect(host.querySelector('[data-testid="delayed-box"]')).toBeNull();

    act(() => {
      root.render(createElement(ConditionalComponent, { active: true }));
    });

    const el = host.querySelector<HTMLDivElement>('[data-testid="delayed-box"]');
    expect(el).not.toBeNull();

    const wheelEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 100,
    });

    act(() => {
      el?.dispatchEvent(wheelEvent);
    });

    expect(wheelEvent.defaultPrevented).toBe(true);
    expect(onVolumeChange).toHaveBeenCalledWith(0.75);
  });
});
