/**
 * Preserves the last rendered video frame during seeks, playback rate changes,
 * or decoder flushes.
 *
 * On WebKitGTK (Linux) with GStreamer, seeking or changing playbackRate sends a
 * flushing seek (`GST_SEEK_FLAG_FLUSH`) down the pipeline. When GStreamer
 * flushes, the video sink drops its sample buffer before the next keyframe
 * prerolls, making the `<video>` element paint transparent/black for 100-300ms.
 * Drawing the current frame to a companion canvas right before a seek/rate
 * change holds the picture on screen until the new frame is presented.
 */

export function canCaptureVideoFrame(video: HTMLVideoElement | null): boolean {
  if (!video) return false;
  if (video.seeking) return false;
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;
  return video.videoWidth > 0 && video.videoHeight > 0;
}

/**
 * Copies the current video frame onto the canvas. Returns true if a frame was
 * successfully drawn, false if the video was not ready or could not be read.
 */
export function freezeVideoFrame(
  video: HTMLVideoElement | null,
  canvas: HTMLCanvasElement | null,
): boolean {
  if (!canCaptureVideoFrame(video) || !canvas) return false;

  const width = video!.videoWidth;
  const height = video!.videoHeight;

  try {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext("2d");
    if (!context) return false;

    context.drawImage(video!, 0, 0, width, height);
    return true;
  } catch {
    // Cross-origin tainted canvas or context loss: fail gracefully without crashing
    return false;
  }
}

/**
 * Invokes `onFrame` once the media element has decoded and presented its next frame,
 * with fallback event listeners and a safety timeout. Returns a cleanup function.
 */
export function waitForVideoFrame(
  video: HTMLVideoElement | null,
  onFrame: () => void,
  timeoutMs = 1500,
): () => void {
  let settled = false;
  let timer: number | null = null;
  let frameCallbackId: number | null = null;

  const done = () => {
    if (settled) return;
    settled = true;
    cleanup();
    onFrame();
  };

  const cleanup = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    if (video) {
      video.removeEventListener("seeked", done);
      video.removeEventListener("playing", done);
      if (
        frameCallbackId !== null &&
        "cancelVideoFrameCallback" in video &&
        typeof (video as { cancelVideoFrameCallback?: (id: number) => void }).cancelVideoFrameCallback === "function"
      ) {
        (video as { cancelVideoFrameCallback: (id: number) => void }).cancelVideoFrameCallback(frameCallbackId);
        frameCallbackId = null;
      }
    }
  };

  if (!video) {
    onFrame();
    return () => {};
  }

  // Modern WebKitGTK and Chromium support requestVideoFrameCallback, which fires
  // at the exact compositor cycle when the new video frame is rendered.
  if (
    "requestVideoFrameCallback" in video &&
    typeof (video as { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback === "function"
  ) {
    frameCallbackId = (video as { requestVideoFrameCallback: (cb: () => void) => number }).requestVideoFrameCallback(done);
  }

  video.addEventListener("seeked", done, { once: true });
  video.addEventListener("playing", done, { once: true });

  timer = window.setTimeout(done, timeoutMs);

  return () => {
    settled = true;
    cleanup();
  };
}
