import type { LyricsEntry, LyricsProvider, LyricsResult } from "./types";
import type { SongItem } from "../../types/music";
import { getEnabledProviders, getOrderedProviders, parseProviderEnabledStates } from "./registry";
import { filterCreditLines, isInstrumentalNotice, normalizeEntries, stripWordTimings } from "./lyricsUtils";
import { cleanTitle } from "./matching";
import { entriesAreSynced, hasWordSync, hasReasonableTimestamps } from "./sync";
import * as cache from "./cache";
import { getOfflineLyrics, OFFLINE_LYRICS_PROVIDER } from "./offline";
import { InFlightRuns } from "./inFlight";
import {
  clearManual,
  forgetLookups,
  isManual,
  markManual,
  markUpgradeLookDone,
  rememberNoLyrics,
  remembersNoLyrics,
  upgradeIsDue,
} from "./lookupMemory";
import { runLyricsSources, type LyricsAnswer, type LyricsReply } from "./providerRun";
import { getSettingValue } from "../../store/useAppSettingsStore";
import { SETTINGS } from "../settings/schema";

const PROVIDER_TIMEOUT_MS = 8000;
const COOLDOWN_MS = 10 * 60 * 1000;
const DISK_CACHE = "DiskCache";

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

/** The lookup for a song: catalogues file it under its first credited artist, not the joined list. */
export function lyricsRequestFor(track: SongItem, durationSec: number): LyricsRequest {
  return {
    videoId: track.videoId ?? track.id,
    title: track.title,
    artist: track.artists.find((a) => a.name)?.name ?? "",
    durationSec: Math.round(durationSec),
    album: track.album?.name ?? null,
  };
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

function remember(videoId: string, result: LyricsResult): void {
  cache.setMemory(videoId, result.entries);
  cache.setDisk(videoId, result.entries);
  markUpgradeLookDone(videoId);
}

// Clears caches + cooldowns so the next getLyrics re-runs every provider.
export function forceRefresh(videoId: string): void {
  cache.evict(videoId);
  forgetLookups(videoId);
  cooldowns.clear();
}

type AnswerListener = (result: LyricsResult) => void;

// What each running song's run shows now, so a caller joining late still gets it.
const runAnswers = new Map<string, LyricsResult>();
const answerListeners = new Map<string, Set<AnswerListener>>();

function publishAnswer(videoId: string, result: LyricsResult): void {
  runAnswers.set(videoId, result);
  answerListeners.get(videoId)?.forEach((listener) => listener(result));
}

function listenForAnswers(videoId: string, listener: AnswerListener): () => void {
  const listeners = answerListeners.get(videoId) ?? new Set<AnswerListener>();
  answerListeners.set(videoId, listeners);
  listeners.add(listener);
  const current = runAnswers.get(videoId);
  if (current) listener(current);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) answerListeners.delete(videoId);
  };
}

/**
 * One provider run per video, shared by every caller; leaving with `signal` lets it stop. It
 * settles with the best lyrics once the run ends, which can take 9 s, so a caller that shows them
 * passes `onAnswer`, which gets the first answer as soon as it is ready and any later swap.
 */
export function getLyrics(
  request: LyricsRequest,
  signal?: AbortSignal,
  onAnswer?: AnswerListener,
): Promise<LyricsResult | null> {
  const stopListening = onAnswer ? listenForAnswers(request.videoId, onAnswer) : null;
  const run = inFlight.join(request.videoId, (runSignal) => fetchLyrics(request, runSignal), signal);
  if (!stopListening) return run;
  return run.finally(stopListening);
}

function savedLyrics(entries: LyricsEntry[]): LyricsResult {
  return { entries, provider: DISK_CACHE };
}

async function askProvider(
  provider: LyricsProvider,
  request: LyricsRequest,
  title: string,
  artist: string,
  signal: AbortSignal,
): Promise<LyricsReply> {
  const { videoId, durationSec, album } = request;
  try {
    const answer = await callProvider(provider.getLyrics(videoId, title, artist, durationSec, album), PROVIDER_TIMEOUT_MS, signal);
    const raw = Array.isArray(answer) ? answer : answer?.entries;
    const source = Array.isArray(answer) ? null : answer?.source ?? null;
    if (!raw || raw.length === 0) return { type: "miss" };
    const entries = filterCreditLines(normalizeEntries(sorted(raw)));
    if (entries.length === 0 || !hasReasonableTimestamps(entries, durationSec)) return { type: "miss" };
    if (!entriesAreSynced(entries)) return { type: "found", kind: "plain", entries, source };
    if (hasWordSync(entries)) return { type: "found", kind: "word", entries, source };
    return { type: "found", kind: "line", entries: stripWordTimings(entries), source };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isAuthFailure(message)) cooldowns.set(provider.name, Date.now() + COOLDOWN_MS);
    return { type: "failed" };
  }
}

async function fetchLyrics(request: LyricsRequest, signal: AbortSignal): Promise<LyricsResult | null> {
  const { videoId, durationSec } = request;

  const mem = cache.getMemory(videoId);
  if (mem && mem.length > 0) {
    const norm = normalizeEntries(mem);
    if (!norm.some((e) => e.words?.length) || hasWordSync(norm)) return { entries: norm, provider: "MemoryCache" };
  }

  // Saved word sync is final, and so is a hand pick. Line or plain lyrics show at once, and look for
  // an upgrade at most once a week.
  let savedCopy: LyricsAnswer | null = null;
  const disk = await cache.getDisk(videoId);
  if (!disk || disk.length === 0) {
    clearManual(videoId);
  } else {
    const norm = normalizeEntries(sorted(disk));
    if (isManual(videoId)) {
      cache.setMemory(videoId, norm);
      return savedLyrics(norm);
    }
    // A notice saved before KuGou's was read as no lyrics would otherwise come back as the fallback.
    if (isInstrumentalNotice(norm) || !hasReasonableTimestamps(norm, durationSec)) {
      cache.evict(videoId);
    } else if (hasWordSync(norm)) {
      cache.setMemory(videoId, norm);
      return savedLyrics(norm);
    } else {
      const copy = stripWordTimings(norm);
      cache.setMemory(videoId, copy);
      if (!upgradeIsDue(videoId)) return savedLyrics(copy);
      savedCopy = { kind: entriesAreSynced(copy) ? "line" : "plain", entries: copy, provider: DISK_CACHE };
    }
  }

  const offlineFallback = (): LyricsResult | null => {
    // The lyrics saved with the download. Not cached, so a later attempt with a working connection
    // can still find a synced version.
    const offline = getOfflineLyrics(videoId);
    return offline ? { entries: offline.entries, provider: OFFLINE_LYRICS_PROVIDER } : null;
  };

  if (!savedCopy && remembersNoLyrics(videoId)) return offlineFallback();

  const title = cleanTitle(request.title);
  const artist = request.artist.trim();
  const now = Date.now();
  const providers = new Map(
    enabledProviders()
      .filter((provider) => (cooldowns.get(provider.name) ?? 0) <= now)
      .map((provider) => [provider.name, provider]),
  );
  const sources = [...providers.keys()];
  const askedEverySource = sources.length === getOrderedProviders(getSettingValue(SETTINGS.LYRICS_PROVIDER_ORDER)).length;

  if (savedCopy) publishAnswer(videoId, savedLyrics(savedCopy.entries));
  try {
    const result = await runLyricsSources({
      sources,
      preferred: sources[0] ?? "",
      alreadyShown: savedCopy?.kind ?? null,
      ask: (name) => askProvider(providers.get(name)!, request, title, artist, signal),
      show: (answer) => {
        // A hand pick made while this run was out stays.
        if (signal.aborted || isManual(videoId)) return false;
        const shown: LyricsResult = { entries: answer.entries, provider: answer.provider, source: answer.source ?? null };
        remember(videoId, shown);
        publishAnswer(videoId, shown);
        return true;
      },
      signal,
    });
    if (savedCopy && !result.best && result.someSourceReplied) markUpgradeLookDone(videoId);
    if (!savedCopy && result.everySourceMissed && askedEverySource) rememberNoLyrics(videoId);
    const best = result.best ?? savedCopy;
    if (best) return { entries: best.entries, provider: best.provider, source: best.source ?? null };
    return offlineFallback();
  } finally {
    runAnswers.delete(videoId);
  }
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
  const artist = request.artist.trim();
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

/** Makes chosen or edited lyrics the lyrics of record for the song: no run replaces them until Refresh. */
export function applyManualLyrics(videoId: string, entries: LyricsEntry[]): void {
  if (entries.length === 0) return;
  markManual(videoId);
  cache.setMemory(videoId, entries);
  cache.setDisk(videoId, entries);
}
