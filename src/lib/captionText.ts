import { invokeBackend } from "./api/errors";
import type { CaptionTrack } from "../types/video";

const LOCAL_URL_PREFIX = "local-subtitle:";

export const localCaptionUrl = (path: string) => `${LOCAL_URL_PREFIX}${path}`;

export const isLocalCaption = (caption: Pick<CaptionTrack, "url">) => caption.url.startsWith(LOCAL_URL_PREFIX);

export const localCaptionPath = (caption: Pick<CaptionTrack, "url">) => caption.url.slice(LOCAL_URL_PREFIX.length);

/** A caption track's text, from YouTube or from a file on this computer. */
export function fetchCaptionText(caption: Pick<CaptionTrack, "url">): Promise<string> {
  if (isLocalCaption(caption)) return invokeBackend<string>("read_subtitle_file", { path: localCaptionPath(caption) });
  return invokeBackend<string>("fetch_subtitles", { url: caption.url });
}
