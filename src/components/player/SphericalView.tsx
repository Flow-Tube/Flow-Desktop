import { useEffect, useRef, type RefObject } from "react";

import { SphericalRenderer } from "../../lib/spherical/renderer";
import { dragLook, initialLook, keyLook, zoomLook, type LookAt, type Projection } from "../../lib/spherical/view";

/** What the player's gesture layer and keys use to look around; a no-op until a view is attached. */
export interface LookAround {
  drag: (dx: number, dy: number) => void;
  zoom: (deltaY: number) => void;
  /** True when the key looked around. */
  key: (key: string) => boolean;
}

// Frames that take this long to draw, this many in a row, mean the computer can't keep up.
const SLOW_FRAME_MS = 50;
const SLOW_FRAMES = 30;

type VideoWithFrames = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

interface SphericalViewProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  projection: Projection;
  /** The look-around speed, 1 to 3. */
  speed: number;
  /** Filled with this view's controls while it is mounted. */
  lookAround: { current: LookAround | null };
  /** The view can't be drawn here (no WebGL) or not smoothly; the player goes back to the flat picture. */
  onUnavailable: () => void;
}

/**
 * A 360 video seen from inside its sphere: the playing frame is drawn on a WebGL canvas over the
 * video, once per new frame and whenever the view moves. Input comes from the gesture layer.
 */
export function SphericalView({ videoRef, projection, speed, lookAround, onUnavailable }: SphericalViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const unavailableRef = useRef(onUnavailable);
  unavailableRef.current = onUnavailable;

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current as VideoWithFrames | null;
    if (!canvas || !video) return;
    const renderer = SphericalRenderer.create(canvas);
    if (!renderer) {
      unavailableRef.current();
      return;
    }
    let look: LookAt = initialLook();
    let slowFrames = 0;
    let viewFrame: number | null = null;
    let videoFrame: number | null = null;
    let disposed = false;

    const paint = (upload: boolean) => {
      const started = performance.now();
      if (upload) renderer.upload(video);
      renderer.draw(look, projection, canvas.width, canvas.height);
      slowFrames = performance.now() - started > SLOW_FRAME_MS ? slowFrames + 1 : 0;
      if (slowFrames >= SLOW_FRAMES) {
        disposed = true;
        unavailableRef.current();
      }
    };
    const redrawView = () => {
      if (viewFrame !== null || disposed) return;
      viewFrame = requestAnimationFrame(() => {
        viewFrame = null;
        paint(video.paused);
      });
    };
    // Each new frame the video shows is drawn once; where frame callbacks are missing, every display frame while it plays.
    const nextFrame = () => {
      if (video.requestVideoFrameCallback) videoFrame = video.requestVideoFrameCallback(onVideoFrame);
      else videoFrame = video.paused ? null : requestAnimationFrame(onVideoFrame);
    };
    function onVideoFrame() {
      if (disposed) return;
      paint(true);
      nextFrame();
    }
    const onPlay = () => {
      if (videoFrame === null) nextFrame();
    };
    nextFrame();

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      redrawView();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    // A seek or a new source while paused shows a new frame without playing one.
    video.addEventListener("seeked", redrawView);
    video.addEventListener("loadeddata", redrawView);
    video.addEventListener("play", onPlay);

    lookAround.current = {
      drag: (dx, dy) => {
        look = dragLook(look, dx, dy, speedRef.current);
        redrawView();
      },
      zoom: (deltaY) => {
        look = zoomLook(look, deltaY);
        redrawView();
      },
      key: (key) => {
        const next = keyLook(look, key, speedRef.current);
        if (!next) return false;
        look = next;
        redrawView();
        return true;
      },
    };

    return () => {
      disposed = true;
      lookAround.current = null;
      observer.disconnect();
      video.removeEventListener("seeked", redrawView);
      video.removeEventListener("loadeddata", redrawView);
      video.removeEventListener("play", onPlay);
      if (viewFrame !== null) cancelAnimationFrame(viewFrame);
      if (videoFrame !== null) {
        if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(videoFrame);
        else cancelAnimationFrame(videoFrame);
      }
    };
  }, [videoRef, projection, lookAround]);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 z-10 h-full w-full" />;
}
