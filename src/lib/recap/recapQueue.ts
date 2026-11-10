import { SETTINGS } from "../settings/schema";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { isTauriEnv } from "../api/env";
import { isInvalidArgsError } from "../api/errors";
import {
  recordRecapBatch,
  type LedgerAction,
  type RecapEntry,
  type RecapListenEvent,
  type RecapViewEvent,
} from "../api/recap";
import { isDeepFlowCurrentlyActive } from "../deepFlow";
import { onBeforeProfileSwitch } from "../profiles/beforeSwitch";
import { isMusicVideo } from "../utils";

const FLUSH_DELAY_MS = 2_000;
const FLUSH_SIZE = 64;
/** A backend that stays down keeps the newest of what it missed, not all of it. */
const MAX_PENDING = 2_000;

let pending: RecapEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;
let installed = false;

/**
 * As on Android, Deep Flow stops everything entering the ledger, even with "Save to watch history"
 * on: that switch is about history. Taking back something stored is always allowed.
 */
function recording(): boolean {
  return !isDeepFlowCurrentlyActive();
}

function install() {
  if (installed) return;
  installed = true;
  const flush = () => flushRecapQueue();
  window.addEventListener("beforeunload", flush);
  onBeforeProfileSwitch(flush);
}

function enqueue(entry: RecapEntry) {
  install();
  pending.push(entry);
  if (pending.length >= FLUSH_SIZE) {
    void flushRecapQueue();
  } else if (timer === null) {
    timer = setTimeout(() => void flushRecapQueue(), FLUSH_DELAY_MS);
  }
}

/** Sends what is queued. Playback only ever adds to an array; the database write happens here. */
export function flushRecapQueue(): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (flushing) return flushing.then(flushRecapQueue);
  if (pending.length === 0) return Promise.resolve();
  const batch = pending;
  pending = [];
  flushing = isTauriEnv()
    .then((inTauri) => (inTauri ? recordRecapBatch(batch) : undefined))
    .catch((error) => {
      console.warn("Failed to save to the recap ledger", error);
      // A batch the command can't read fails the same way every time, and would hold up the rest.
      if (!isInvalidArgsError(error)) pending = [...batch, ...pending].slice(-MAX_PENDING);
    })
    .finally(() => {
      flushing = null;
    });
  return flushing;
}

export function recapView(event: RecapViewEvent) {
  // A view names what was watched, so it also stops while watch history is paused. Android's rule.
  const paused = useAppSettingsStore.getState().values[SETTINGS.PAUSE_WATCH_HISTORY] === "true";
  if (recording() && !paused) enqueue({ kind: "view", atMs: Date.now(), ...event });
}

export function recapListen(event: RecapListenEvent) {
  if (recording()) enqueue({ kind: "listen", atMs: Date.now(), ...event });
}

export function recapDislike(video: { id: string; title: string; channelName?: string | null }) {
  if (!recording()) return;
  enqueue({
    kind: "dislike",
    atMs: Date.now(),
    videoId: video.id,
    title: video.title,
    channelName: video.channelName ?? "",
  });
}

export function recapDislikeRemoved(videoId: string) {
  enqueue({ kind: "dislikeRemoved", atMs: Date.now(), videoId });
}

export function recapAction(action: LedgerAction) {
  if (recording()) enqueue({ kind: "action", atMs: Date.now(), action });
}

/** An action on a video; music in the video player stays out of the video ledger. */
export function recapVideoAction(video: { viewCountText?: string | null; channelName?: string | null }, action: LedgerAction) {
  if (!isMusicVideo(video)) recapAction(action);
}

export function recapSearch(query: string | null) {
  if (recording()) enqueue({ kind: "search", atMs: Date.now(), query });
}

/** Skipped time on a video; music in the video player stays out of the video ledger. */
export function recapSponsorSkip(
  video: { viewCountText?: string | null; channelName?: string | null },
  category: string,
  skippedMs: number,
) {
  if (recording() && !isMusicVideo(video)) enqueue({ kind: "sponsorSkip", atMs: Date.now(), category, skippedMs: Math.round(skippedMs) });
}

/** As on Android, saying no to an artist is noted even in Deep Flow. */
export function recapArtistSaidNo(artistId: string | null, artistName: string, blocked: boolean) {
  enqueue({ kind: "artistSaidNo", atMs: Date.now(), artistId, artistName, blocked });
}

/** Search history was cleared: the recap forgets every stored search text. */
export function recapQueriesCleared() {
  enqueue({ kind: "queriesCleared" });
}
