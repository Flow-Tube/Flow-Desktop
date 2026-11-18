import { savePngImage } from "./api/files";
import { blobToBase64 } from "./canvasImage";
import { copyPng } from "./clipboard";
import { safeFileName } from "./fileName";
import { getString } from "./i18n/index";

/** Why a frame could not be taken: the video has no picture yet, or its source forbids reading it. */
export type FrameProblem = "notReady" | "blocked";

export class FrameCaptureError extends Error {
  constructor(readonly problem: FrameProblem) {
    super(problem);
  }
}

/** The picture on screen now, at the video's own resolution, as a PNG. Drawn at once, so later frames don't replace it. */
export function captureFrame(video: HTMLVideoElement | null): Promise<Blob> {
  if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) {
    return Promise.reject(new FrameCaptureError("notReady"));
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new FrameCaptureError("notReady"));
  context.drawImage(video, 0, 0);
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new FrameCaptureError("notReady"))), "image/png");
    } catch (error) {
      // A video from another origin taints the canvas, which then can never be read.
      reject(new FrameCaptureError(error instanceof DOMException && error.name === "SecurityError" ? "blocked" : "notReady"));
    }
  });
}

/** "Title 1h02m03s.png": the video and the moment, in a name every file system accepts. */
export function frameFileName(title: string | undefined, seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const [h, m, s] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = h > 0 ? `${h}h${pad(m)}m${pad(s)}s` : m > 0 ? `${m}m${pad(s)}s` : `${s}s`;
  return `${safeFileName(`${title?.trim() || "Flow"} ${stamp}`, "flow-frame")}.png`;
}

const problemMessage = (error: unknown, fallback: Parameters<typeof getString>[0]) =>
  getString(
    error instanceof FrameCaptureError
      ? error.problem === "blocked"
        ? "player_frame_blocked"
        : "player_frame_not_ready"
      : fallback,
  );

/** Copies the frame on screen. Call it inside the click: WebKit only lets a clipboard write start there. */
export function copyVideoFrame(video: HTMLVideoElement | null, notify: (message: string) => void): Promise<void> {
  const image = captureFrame(video);
  const problem = image.then(
    () => null,
    (error: unknown) => error,
  );
  return copyPng(image).then(async (copied) => {
    notify(copied ? getString("player_frame_copied") : problemMessage(await problem, "player_frame_copy_failed"));
  });
}

/** Asks where to save the frame on screen as a PNG named after the video and the moment. */
export async function saveVideoFrame(
  video: HTMLVideoElement | null,
  title: string | undefined,
  notify: (message: string) => void,
): Promise<void> {
  const seconds = video?.currentTime ?? 0;
  try {
    const blob = await captureFrame(video);
    if (await savePngImage(await blobToBase64(blob), frameFileName(title, seconds), getString("player_frame_save_title"))) {
      notify(getString("player_frame_saved"));
    }
  } catch (error) {
    if (!(error instanceof FrameCaptureError)) console.warn("Failed to save the video frame", error);
    notify(problemMessage(error, "player_frame_save_failed"));
  }
}
