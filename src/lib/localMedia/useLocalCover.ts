import { useEffect, useState, type RefObject } from "react";

import { getLocalCover, getLocalStream, saveLocalFrame } from "../api/localMedia";
import { useNearViewport } from "../nearViewport";
import { localPlaybackError } from "./playability";
import { grabVideoFrame } from "./videoFrame";

const known = new Map<string, Promise<string | null>>();

/** A video with no picture of its own shows a frame from it, kept so it's only taken once. */
async function frameCover(id: string): Promise<string | null> {
  const stream = await getLocalStream(id);
  if (localPlaybackError(stream)) return null;
  const frame = await grabVideoFrame(stream.url);
  return frame ? saveLocalFrame(id, frame) : null;
}

export function coverOf(id: string, isVideo: boolean): Promise<string | null> {
  let request = known.get(id);
  if (!request) {
    request = getLocalCover(id)
      .then((cover) => cover ?? (isVideo ? frameCover(id) : null))
      .catch(() => null);
    known.set(id, request);
  }
  return request;
}

/** A library file's cover, asked for once it nears the screen, so a long grid reads few files. */
export function useLocalCover(id: string, ref: RefObject<Element | null>, isVideo = false): string | null {
  const near = useNearViewport(ref, true);
  const [cover, setCover] = useState<{ id: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    void coverOf(id, isVideo).then((url) => {
      if (!cancelled) setCover({ id, url });
    });
    return () => {
      cancelled = true;
    };
  }, [id, isVideo, near]);

  return cover?.id === id ? cover.url : null;
}
