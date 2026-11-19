import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canCaptureVideoFrame,
  freezeVideoFrame,
  waitForVideoFrame,
} from "./videoFreeze";

const fakeVideo = (overrides: Partial<HTMLVideoElement> = {}): HTMLVideoElement => {
  const listeners: Record<string, ((e?: Event) => void)[]> = {};
  return {
    seeking: false,
    readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
    videoWidth: 1280,
    videoHeight: 720,
    addEventListener: vi.fn((event: string, handler: (e?: Event) => void) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
    }),
    removeEventListener: vi.fn((event: string, handler: (e?: Event) => void) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((h) => h !== handler);
      }
    }),
    dispatchEvent: vi.fn((event: Event) => {
      const handlers = listeners[event.type] || [];
      handlers.forEach((h) => h(event));
      return true;
    }),
    ...overrides,
  } as unknown as HTMLVideoElement;
};

describe("canCaptureVideoFrame", () => {
  it("returns false for null or undefined", () => {
    expect(canCaptureVideoFrame(null)).toBe(false);
  });

  it("returns false while seeking", () => {
    const video = fakeVideo({ seeking: true });
    expect(canCaptureVideoFrame(video)).toBe(false);
  });

  it("returns false when readyState is below HAVE_CURRENT_DATA", () => {
    const video = fakeVideo({ readyState: HTMLMediaElement.HAVE_METADATA });
    expect(canCaptureVideoFrame(video)).toBe(false);
  });

  it("returns false when dimensions are invalid", () => {
    expect(canCaptureVideoFrame(fakeVideo({ videoWidth: 0 }))).toBe(false);
    expect(canCaptureVideoFrame(fakeVideo({ videoHeight: 0 }))).toBe(false);
  });

  it("returns true when decodable picture is available", () => {
    expect(canCaptureVideoFrame(fakeVideo())).toBe(true);
  });
});

describe("freezeVideoFrame", () => {
  let drawImage: ReturnType<typeof vi.fn>;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    drawImage = vi.fn();
    canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({ drawImage }),
    } as unknown as HTMLCanvasElement;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false if video cannot be captured", () => {
    expect(freezeVideoFrame(null, canvas)).toBe(false);
    expect(freezeVideoFrame(fakeVideo({ seeking: true }), canvas)).toBe(false);
    expect(drawImage).not.toHaveBeenCalled();
  });

  it("returns false if canvas is null", () => {
    expect(freezeVideoFrame(fakeVideo(), null)).toBe(false);
  });

  it("resizes canvas and draws video frame", () => {
    const video = fakeVideo({ videoWidth: 1920, videoHeight: 1080 });
    const result = freezeVideoFrame(video, canvas);
    expect(result).toBe(true);
    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(1080);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1920, 1080);
  });

  it("catches drawing exceptions gracefully", () => {
    const errorContext = {
      drawImage: vi.fn().mockImplementation(() => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      }),
    };
    const throwingCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(errorContext),
    } as unknown as HTMLCanvasElement;

    const result = freezeVideoFrame(fakeVideo(), throwingCanvas);
    expect(result).toBe(false);
  });
});

describe("waitForVideoFrame", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("invokes onFrame immediately if video is null", () => {
    const onFrame = vi.fn();
    waitForVideoFrame(null, onFrame);
    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it("uses requestVideoFrameCallback when supported", () => {
    const onFrame = vi.fn();
    let rfcCallback: (() => void) | null = null;
    const video = fakeVideo({
      requestVideoFrameCallback: vi.fn().mockImplementation((cb: () => void) => {
        rfcCallback = cb;
        return 42;
      }),
    });

    waitForVideoFrame(video, onFrame);
    expect(video.requestVideoFrameCallback).toHaveBeenCalled();
    expect(onFrame).not.toHaveBeenCalled();

    (rfcCallback as (() => void) | null)?.();
    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it("falls back to seeked event", () => {
    const onFrame = vi.fn();
    const video = fakeVideo();
    waitForVideoFrame(video, onFrame);

    video.dispatchEvent(new Event("seeked"));
    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it("falls back to playing event", () => {
    const onFrame = vi.fn();
    const video = fakeVideo();
    waitForVideoFrame(video, onFrame);

    video.dispatchEvent(new Event("playing"));
    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it("falls back to safety timeout", () => {
    const onFrame = vi.fn();
    const video = fakeVideo();
    waitForVideoFrame(video, onFrame, 500);

    vi.advanceTimersByTime(499);
    expect(onFrame).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2);
    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it("allows cancellation before trigger", () => {
    const onFrame = vi.fn();
    const video = fakeVideo();
    const cancel = waitForVideoFrame(video, onFrame, 500);

    cancel();
    video.dispatchEvent(new Event("seeked"));
    vi.advanceTimersByTime(600);
    expect(onFrame).not.toHaveBeenCalled();
  });
});
