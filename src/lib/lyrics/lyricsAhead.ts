import { upcomingIndex } from "../musicQueueOrder";
import { isLocalMediaId } from "../localMediaId";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { getLyrics, lyricsRequestFor } from "./lyricsHelper";

let ahead: AbortController | null = null;

/** Skipped songs cost one lookup each, so this needs a network. A file's name never goes out. */
export function shouldFetchLyricsAhead(
  currentId: string,
  nextId: string | null | undefined,
  nextHasNames: boolean,
  online: boolean,
): boolean {
  return Boolean(nextId) && nextId !== currentId && !isLocalMediaId(nextId) && nextHasNames && online;
}

/** One song ahead, once this song's lyrics are done, so they are ready when it starts. */
export function fetchLyricsAhead(currentId: string): void {
  const state = useMusicPlayerStore.getState();
  const next = state.queue[upcomingIndex(state)];
  const nextId = next ? next.videoId ?? next.id : null;
  const hasNames = Boolean(next?.title && next.artists.some((artist) => artist.name));
  if (!next || !shouldFetchLyricsAhead(currentId, nextId, hasNames, navigator.onLine)) return;
  ahead?.abort();
  const controller = new AbortController();
  ahead = controller;
  // Nobody is waiting on this: what it finds lands in the cache the song's own lookup reads.
  void getLyrics(lyricsRequestFor(next, next.duration ?? 0), controller.signal).catch(() => {});
}

/** A skip stops the run ahead. When it skips to that very song, its own lookup has joined by now. */
export function stopFetchingAhead(): void {
  ahead?.abort();
  ahead = null;
}
