import { afterEach, describe, expect, it, vi } from "vitest";

import { captureFrame, FrameCaptureError, frameFileName } from "./videoFrame";

const video = (overrides: Partial<HTMLVideoElement> = {}) =>
  ({ readyState: HTMLMediaElement.HAVE_ENOUGH_DATA, videoWidth: 1920, videoHeight: 1080, currentTime: 0, ...overrides }) as HTMLVideoElement;

const problemOf = (promise: Promise<Blob>) => promise.then(() => null, (error: FrameCaptureError) => error.problem);

describe("frameFileName", () => {
  it("names the video and the moment", () => {
    expect(frameFileName("My video", 3723.9)).toBe("My video 1h02m03s.png");
    expect(frameFileName("My video", 125)).toBe("My video 2m05s.png");
    expect(frameFileName("My video", 7)).toBe("My video 7s.png");
  });

  it("keeps every script and drops characters file systems refuse", () => {
    expect(frameFileName("Мои: видео/1", 0)).toBe("Мои_ видео_1 0s.png");
    expect(frameFileName(undefined, Number.NaN)).toBe("Flow 0s.png");
  });
});

describe("captureFrame", () => {
  afterEach(() => vi.restoreAllMocks());

  it("waits for a picture", async () => {
    expect(await problemOf(captureFrame(null))).toBe("notReady");
    expect(await problemOf(captureFrame(video({ readyState: HTMLMediaElement.HAVE_METADATA })))).toBe("notReady");
    expect(await problemOf(captureFrame(video({ videoWidth: 0 })))).toBe("notReady");
  });

  it("draws at the video's own size", async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation(function (this: HTMLCanvasElement, done: BlobCallback) {
        expect([this.width, this.height]).toEqual([1920, 1080]);
        done(new Blob(["png"], { type: "image/png" }));
      });
    const blob = await captureFrame(video());
    expect(blob.type).toBe("image/png");
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png");
  });

  it("says when the video's source forbids reading it", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(() => {
      throw new DOMException("tainted", "SecurityError");
    });
    expect(await problemOf(captureFrame(video()))).toBe("blocked");
  });
});
