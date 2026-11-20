import { act, createElement, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { frameEndsHold, heldFrameSize, useFrameHold, type FrameHold } from "./useFrameHold";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("heldFrameSize", () => {
  it("keeps the video's shape and no more pixels than the screen area", () => {
    expect(heldFrameSize(3840, 2160, 960, 540, 2)).toEqual({ width: 1920, height: 1080 });
  });

  it("never draws more pixels than the video has", () => {
    expect(heldFrameSize(1280, 720, 1920, 1080, 2)).toEqual({ width: 1280, height: 720 });
  });

  it("keeps the cropped side sharp for a cover fit", () => {
    // A 16:9 frame covering a square box is scaled by the height.
    expect(heldFrameSize(3840, 2160, 1000, 1000, 1)).toEqual({ width: 1778, height: 1000 });
  });

  it("refuses a video or box with no size", () => {
    expect(heldFrameSize(0, 720, 960, 540, 1)).toBeNull();
    expect(heldFrameSize(1280, 720, 0, 540, 1)).toBeNull();
  });
});

describe("frameEndsHold", () => {
  it("ends a seek hold on a frame at the target once the seek is done", () => {
    const seek = { kind: "seek", target: 120 } as const;
    expect(frameEndsHold(seek, 120.03, 1, true)).toBe(true);
    expect(frameEndsHold(seek, 120.03, 1, false)).toBe(false);
    expect(frameEndsHold(seek, 10, 3, true)).toBe(false);
  });

  it("ends a speed hold on the second frame, since the first is still from before the flush", () => {
    expect(frameEndsHold({ kind: "rate" }, 31.16, 1, true)).toBe(false);
    expect(frameEndsHold({ kind: "rate" }, 31.19, 2, true)).toBe(true);
  });
});

type FrameCallback = (now: number, metadata: { mediaTime: number }) => void;

function fakeVideo({ withFrameCallbacks = true } = {}) {
  const video = document.createElement("video");
  const callbacks = new Map<number, FrameCallback>();
  let nextHandle = 1;
  for (const [key, value] of Object.entries({ readyState: 4, videoWidth: 1280, videoHeight: 720, clientWidth: 640, clientHeight: 360 })) {
    Object.defineProperty(video, key, { configurable: true, value });
  }
  if (withFrameCallbacks) {
    Object.assign(video, {
      requestVideoFrameCallback: (callback: FrameCallback) => {
        callbacks.set(nextHandle, callback);
        return nextHandle++;
      },
      cancelVideoFrameCallback: (handle: number) => callbacks.delete(handle),
    });
  }
  const present = (mediaTime: number) => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    pending.forEach((callback) => callback(performance.now(), { mediaTime }));
  };
  return { video, present };
}

describe("useFrameHold", () => {
  let host: HTMLDivElement;
  let root: Root;
  let drawImage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function mount(video: HTMLVideoElement, enabled = true): FrameHold {
    const videoRef: RefObject<HTMLVideoElement | null> = { current: video };
    const out: { hold: FrameHold | null } = { hold: null };
    function Probe() {
      const hold = useFrameHold(videoRef, enabled);
      out.hold = hold;
      return createElement("canvas", { ref: hold.canvasRef, hidden: true });
    }
    act(() => root.render(createElement(Probe)));
    return out.hold!;
  }

  const canvas = () => host.querySelector("canvas")!;

  it("shows the last frame through a seek and lets go on a frame at the target", () => {
    const { video, present } = fakeVideo();
    video.style.transform = "translate(10px, 0px) scale(2)";
    const hold = mount(video);
    const write = vi.fn();

    hold.around({ kind: "seek", target: 120 }, write);

    expect(write).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 640, 360);
    expect(canvas().hidden).toBe(false);
    expect(canvas().style.transform).toBe(video.style.transform);

    present(12);
    expect(canvas().hidden).toBe(false);
    video.dispatchEvent(new Event("seeked"));
    present(120.02);
    expect(canvas().hidden).toBe(true);
    expect(canvas().width).toBe(0);
  });

  it("waits for the second frame after a speed change", () => {
    const { video, present } = fakeVideo();
    const hold = mount(video);

    hold.around({ kind: "rate" }, () => {});
    present(31.16);
    expect(canvas().hidden).toBe(false);
    present(31.19);
    expect(canvas().hidden).toBe(true);
  });

  it("keeps the frame already up when a second seek lands during a hold", () => {
    const { video, present } = fakeVideo();
    const hold = mount(video);

    hold.around({ kind: "seek", target: 120 }, () => {});
    hold.around({ kind: "seek", target: 130 }, () => {});
    expect(drawImage).toHaveBeenCalledTimes(1);

    video.dispatchEvent(new Event("seeked"));
    present(120);
    expect(canvas().hidden).toBe(false);
    present(130);
    expect(canvas().hidden).toBe(true);
  });

  it("lets go after a while when no new frame arrives", () => {
    const { video } = fakeVideo();
    const hold = mount(video);

    hold.around({ kind: "rate" }, () => {});
    vi.advanceTimersByTime(1499);
    expect(canvas().hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(canvas().hidden).toBe(true);
  });

  it("only runs the change when the hold is off or the video can't report frames", () => {
    for (const [video, enabled] of [
      [fakeVideo().video, false],
      [fakeVideo({ withFrameCallbacks: false }).video, true],
    ] as const) {
      const hold = mount(video, enabled);
      const write = vi.fn();
      hold.around({ kind: "seek", target: 5 }, write);
      expect(write).toHaveBeenCalledTimes(1);
      expect(canvas().hidden).toBe(true);
    }
    expect(drawImage).not.toHaveBeenCalled();
  });

  it("drops a hold when told to, as on a new video", () => {
    const { video } = fakeVideo();
    const hold = mount(video);

    hold.around({ kind: "seek", target: 120 }, () => {});
    hold.release();
    expect(canvas().hidden).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(canvas().hidden).toBe(true);
  });
});
