import { useEffect, useRef, type RefObject } from "react";
import {
  AmbientPipeline,
  DISPLAY_H,
  DISPLAY_W,
  SAMPLE_H,
  SAMPLE_W,
  SMOOTH_IDLE_TICK_MS,
  SMOOTH_TICK_MS,
  type AmbientLook,
} from "./pipeline";

// drawImage plus getImageData blocks the main thread, like Android's TextureView path.
const CAPTURE_MS = 1800;
const IDLE_MS = 1500;
const MAX_BACKOFF_MULTIPLIER = 8;
const MAX_STEP_MS = 500;

type Capture = "ok" | "retry" | "unsupported";

/*
  Two loops, as on Android: capture sets a target at a slow cadence, and smoothing walks the drawn
  grid toward it on its own clock. The whole glow is one canvas moving as one image, so no part of
  it can change color ahead of another.
*/
export function useAmbientFrame(
  videoRef: RefObject<HTMLVideoElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  look: AmbientLook,
) {
  const lookRef = useRef(look);
  const redrawRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    lookRef.current = look;
    redrawRef.current?.();
  }, [look]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const sample = document.createElement("canvas");
    sample.width = SAMPLE_W;
    sample.height = SAMPLE_H;
    const sampleContext = sample.getContext("2d", { willReadFrequently: true });
    if (!sampleContext) return;

    const pipeline = new AmbientPipeline();
    const output = context.createImageData(DISPLAY_W, DISPLAY_H);
    let captureTimer: number | undefined;
    let smoothTimer: number | undefined;
    let failures = 0;
    let supported = true;

    const draw = () => {
      pipeline.encode(output.data, lookRef.current);
      context.putImageData(output, 0, 0);
    };
    redrawRef.current = () => {
      if (pipeline.hasFrame) draw();
    };

    const captureFrame = (): Capture => {
      const video = videoRef.current;
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0) return "retry";
      try {
        sampleContext.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
        pipeline.offerFrame(sampleContext.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data);
        return "ok";
      } catch (error) {
        // A tainted canvas can never be read. Anything else may pass once the video settles.
        return error instanceof DOMException && error.name === "SecurityError" ? "unsupported" : "retry";
      }
    };

    const captureLoop = () => {
      let cadence = IDLE_MS;
      const video = videoRef.current;
      if (!document.hidden && video && !video.paused && !video.ended) {
        const result = captureFrame();
        if (result === "unsupported") {
          supported = false;
          return;
        }
        if (result === "ok") {
          failures = 0;
          cadence = CAPTURE_MS;
        } else {
          failures += 1;
          cadence = CAPTURE_MS * Math.min(MAX_BACKOFF_MULTIPLIER, 2 ** Math.min(failures, 3));
        }
      }
      captureTimer = window.setTimeout(captureLoop, cadence);
    };

    let last = performance.now();
    const smoothLoop = () => {
      const now = performance.now();
      const dt = Math.min(MAX_STEP_MS, Math.max(1, now - last));
      last = now;
      const moved = !document.hidden && pipeline.advance(dt);
      if (moved) draw();
      smoothTimer = window.setTimeout(smoothLoop, moved ? SMOOTH_TICK_MS : SMOOTH_IDLE_TICK_MS);
    };

    // A seek or a first frame while paused still has to reach the glow; the filter smooths it as usual.
    const captureNow = () => {
      if (supported && !document.hidden) captureFrame();
    };
    const video = videoRef.current;
    video?.addEventListener("loadeddata", captureNow);
    video?.addEventListener("seeked", captureNow);

    captureNow();
    captureLoop();
    smoothLoop();

    return () => {
      window.clearTimeout(captureTimer);
      window.clearTimeout(smoothTimer);
      video?.removeEventListener("loadeddata", captureNow);
      video?.removeEventListener("seeked", captureNow);
      redrawRef.current = null;
    };
  }, [videoRef, canvasRef]);
}
