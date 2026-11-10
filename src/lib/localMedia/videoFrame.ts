/** Far enough in to miss a fade from black, not so far that a long film is slow to seek. */
const FRAME_AT_FRACTION = 0.1;
const FRAME_AT_MOST_SECONDS = 60;
const FRAME_WIDTH_PX = 640;
const JPEG_QUALITY = 0.82;
const GIVE_UP_MS = 15_000;

function drawFrame(video: HTMLVideoElement): string | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(FRAME_WIDTH_PX, video.videoWidth);
  canvas.height = Math.round((canvas.width * video.videoHeight) / video.videoWidth);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const [, base64] = canvas.toDataURL("image/jpeg", JPEG_QUALITY).split(",");
  return base64 || null;
}

function grab(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (frame: string | null) => {
      if (timer) clearTimeout(timer);
      video.onloadedmetadata = video.onseeked = video.onerror = null;
      video.removeAttribute("src");
      video.load();
      resolve(frame);
    };
    timer = setTimeout(() => finish(null), GIVE_UP_MS);
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    video.onerror = () => finish(null);
    video.onloadedmetadata = () => {
      const seconds = Math.min(video.duration * FRAME_AT_FRACTION, FRAME_AT_MOST_SECONDS);
      if (!(seconds > 0)) finish(null);
      else video.currentTime = seconds;
    };
    video.onseeked = () => {
      try {
        finish(drawFrame(video));
      } catch {
        finish(null);
      }
    };
    video.src = url;
    video.load();
  });
}

let previous: Promise<unknown> = Promise.resolve();

/**
 * A frame from the video as base64 JPEG, or null when the webview can't decode it. Taken one at a
 * time, so a folder of videos doesn't open a decoder for each card on screen.
 */
export function grabVideoFrame(url: string): Promise<string | null> {
  const next = previous.then(() => grab(url));
  previous = next;
  return next;
}
