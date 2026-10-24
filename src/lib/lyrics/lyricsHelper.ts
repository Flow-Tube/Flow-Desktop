import type { LyricsEntry, LyricsProvider, LyricsResult } from "./types";
import { getEnabledProviders, parseProviderEnabledStates } from "./registry";
import { filterCreditLines, normalizeEntries, stripWordTimings } from "./lyricsUtils";
import { cleanArtist, cleanTitle } from "./matching";
import { entriesAreSynced, hasWordSync, hasReasonableTimestamps } from "./sync";
import * as cache from "./cache";
import { getOfflineLyrics } from "./offline";
import { InFlightRuns } from "./inFlight";
import { getSettingValue } from "../../store/useAppSettingsStore";
import { SETTINGS } from "../settings/schema";

const PROVIDER_TIMEOUT_MS = 8000;
const TOTAL_TIMEOUT_MS = 25000;
const COOLDOWN_MS = 10 * 60 * 1000;
// After a line-synced hit, the providers after it get this long in total to find word sync.
const WORD_SYNC_GRACE_MS = 4000;

export interface LyricsCandidate {
  providerName: string;
  entries: LyricsEntry[];
  synced: boolean;
}

export interface LyricsRequest {
  videoId: string;
  title: string;
  /** The primary artist: catalogues file a song under its first credited artist. */
  artist: string;
  durationSec: number;
  album?: string | null;
}

const cooldowns = new Map<string, number>();
// The player and downloads ask for the song that just started; they share one provider run.
const inFlight = new InFlightRuns<string, LyricsResult | null>();

function isAuthFailure(message: string): boolean {
  return (
    message.includes(" 401") ||
    message.includes(" 403") ||
    /unauthorized/i.test(message) ||
    /forbidden/i.test(message)
  );
}

class ProviderTimeout extends Error {}

/** Waits for one provider, giving up at its deadline or once the run is abandoned. */
function callProvider<T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      finish();
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      finish();
      reject(new ProviderTimeout("timeout"));
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        finish();
        resolve(value);
      },
      (error: unknown) => {
        finish();
        reject(error);
      },
    );
  });
}

const sorted = (entries: LyricsEntry[]): LyricsEntry[] => [...entries].sort((a, b) => a.time - b.time);

function enabledProviders(): LyricsProvider[] {
  const enabledStates = parseProviderEnabledStates(getSettingValue(SETTINGS.LYRICS_PROVIDER_ENABLED_STATES));
  return getEnabledProviders(getSettingValue(SETTINGS.LYRICS_PROVIDER_ORDER), enabledStates);
}

function remember(videoId: string, result: LyricsResult): LyricsResult {
  cache.setMemory(videoId, result.entries);
  cache.setDisk(videoId, result.entries);
  return result;
}

// Clears caches + cooldowns so the next getLyrics re-runs every provider.
export function forceRefresh(videoId: string): void {
  cache.evict(videoId);
  cooldowns.clear();
}

/** One provider run per video, shared by every caller; leaving with `signal` lets it stop. */
export function getLyrics(request: LyricsRequest, signal?: AbortSignal): Promise<LyricsResult | null> {
  return inFlight.join(request.videoId, (runSignal) => fetchLyrics(request, runSignal), signal);
}

async function fetchLyrics(request: LyricsRequest, signal: AbortSignal): Promise<LyricsResult | null> {
  const { videoId, durationSec, album } = request;

  const mem = cache.getMemory(videoId);
  if (mem && mem.length > 0) {
    const norm = normalizeEntries(mem);
    if (!norm.some((e) => e.words?.length) || hasWordSync(norm)) return { entries: norm, provider: "MemoryCache" };
  }

  // Disk cache: word sync is final; line or plain lyrics stay a fallback while providers try to
  // upgrade them.
  let cachedFallback: LyricsResult | null = null;
  const disk = await cache.getDisk(videoId);
  if (disk && disk.length > 0) {
    const norm = normalizeEntries(sorted(disk));
    if (hasWordSync(norm) && hasReasonableTimestamps(norm, durationSec)) {
      cache.setMemory(videoId, norm);
      return { entries: norm, provider: "DiskCache" };
    }
    if (hasReasonableTimestamps(norm, durationSec)) {
      cachedFallback = { entries: stripWordTimings(norm), provider: "DiskCache" };
    } else {
      cache.evict(videoId);
    }
  }

  const title = cleanTitle(request.title);
  const artist = cleanArtist(request.artist);
  const startedAt = Date.now();
  let lineSynced: LyricsResult | null = null;
  let unsynced: LyricsResult | null = null;
  let wordSyncDeadline = Number.POSITIVE_INFINITY;

  for (const provider of enabledProviders()) {
    if (signal.aborted) throw signal.reason;
    const now = Date.now();
    if ((cooldowns.get(provider.name) ?? 0) > now) continue;
    const timeout = Math.min(PROVIDER_TIMEOUT_MS, wordSyncDeadline - now, TOTAL_TIMEOUT_MS - (now - startedAt));
    if (timeout <= 0) break;

    try {
      const answer = await callProvider(provider.getLyrics(videoId, title, artist, durationSec, album), timeout, signal);
      const raw = Array.isArray(answer) ? answer : answer?.entries;
      const source = Array.isArray(answer) ? null : answer?.source ?? null;
      if (!raw || raw.length === 0) continue;

      const entries = filterCreditLines(normalizeEntries(sorted(raw)));
      if (entries.length === 0 || !hasReasonableTimestamps(entries, durationSec)) continue;

      if (entriesAreSynced(entries) && hasWordSync(entries)) {
        return remember(videoId, { entries, provider: provider.name, source });
      }
      if (entriesAreSynced(entries)) {
        if (!lineSynced) {
          lineSynced = { entries: stripWordTimings(entries), provider: provider.name, source };
          wordSyncDeadline = Date.now() + WORD_SYNC_GRACE_MS;
        }
      } else if (!unsynced) {
        unsynced = { entries, provider: provider.name, source };
      }
    } catch (e) {
      if (signal.aborted) throw signal.reason;
      const msg = e instanceof Error ? e.message : String(e);
      if (isAuthFailure(msg)) cooldowns.set(provider.name, Date.now() + COOLDOWN_MS);
    }
  }

  const found = lineSynced ?? unsynced;
  if (found) return remember(videoId, found);
  if (cachedFallback) {
    cache.setMemory(videoId, cachedFallback.entries);
    return cachedFallback;
  }

  // Last resort: the lyrics saved with the download. Not cached, so a later attempt with a working
  // connection can still find a synced version.
  const offline = getOfflineLyrics(videoId);
  return offline ? { entries: offline.entries, provider: "Downloaded" } : null;
}

/**
 * Streams a result from every enabled provider, in the user's order, so the lyrics menu can offer
 * alternatives when the automatic pick is wrong. Unlike `getLyrics` it never stops at the first
 * synced hit and never touches the caches.
 */
export async function getAllLyrics(
  request: LyricsRequest,
  onCandidate: (candidate: LyricsCandidate) => void,
  signal: AbortSignal,
): Promise<void> {
  const title = cleanTitle(request.title);
  const artist = cleanArtist(request.artist);
  for (const provider of enabledProviders()) {
    if (signal.aborted) return;
    try {
      const answer = await callProvider(
        provider.getLyrics(request.videoId, title, artist, request.durationSec, request.album),
        PROVIDER_TIMEOUT_MS,
        signal,
      );
      const raw = Array.isArray(answer) ? answer : answer?.entries;
      if (!raw || raw.length === 0) continue;
      const entries = filterCreditLines(normalizeEntries(sorted(raw)));
      if (entries.length > 0 && hasReasonableTimestamps(entries, request.durationSec) && !signal.aborted) {
        onCandidate({ providerName: provider.name, entries, synced: entriesAreSynced(entries) });
      }
    } catch {
      if (signal.aborted) return;
    }
  }
}

/** Makes chosen or edited lyrics the lyrics of record for the song, so they survive a restart. */
export function applyManualLyrics(videoId: string, entries: LyricsEntry[]): void {
  if (entries.length === 0) return;
  cache.setMemory(videoId, entries);
  cache.setDisk(videoId, entries);
}
