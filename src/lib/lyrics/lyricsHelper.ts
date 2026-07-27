import type { LyricsEntry, LyricsResult } from "./types";
import { getEnabledProviders, parseProviderEnabledStates } from "./registry";
import {
  cleanTitle,
  cleanArtist,
  filterCreditLines,
  normalizeEntries,
  stripWordTimings,
} from "./lyricsUtils";
import { entriesAreSynced, hasWordSync, hasReasonableTimestamps } from "./sync";
import * as cache from "./cache";
import { getOfflineLyrics } from "./offline";
import { getSettingValue } from "../../store/useAppSettingsStore";
import { SETTINGS } from "../settings/schema";

const PROVIDER_TIMEOUT_MS = 8000;
const TOTAL_TIMEOUT_MS = 25000;
const COOLDOWN_MS = 10 * 60 * 1000;

const cooldowns = new Map<string, number>();

function isAuthFailure(message: string): boolean {
  return (
    message.includes(" 401") ||
    message.includes(" 403") ||
    /unauthorized/i.test(message) ||
    /forbidden/i.test(message)
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

const sorted = (entries: LyricsEntry[]): LyricsEntry[] =>
  [...entries].sort((a, b) => a.time - b.time);

// Clears caches + cooldowns so the next getLyrics re-runs every provider.
export function forceRefresh(videoId: string): void {
  cache.evict(videoId);
  cooldowns.clear();
}

export async function getLyrics(
  videoId: string,
  title: string,
  artist: string,
  durationSec: number,
  album?: string | null,
): Promise<LyricsResult | null> {
  // 1) Memory cache — return whatever best result we already resolved.
  const mem = cache.getMemory(videoId);
  if (mem && mem.length > 0) return { entries: mem, provider: "MemoryCache" };

  // 2) Disk cache — promote word-sync, keep line-only as a fallback, else evict.
  let fallback: LyricsResult | null = null;
  const disk = cache.getDisk(videoId);
  if (disk && disk.length > 0) {
    const norm = normalizeEntries(sorted(disk));
    if (hasWordSync(norm) && hasReasonableTimestamps(norm, durationSec)) {
      cache.setMemory(videoId, norm);
      return { entries: norm, provider: "DiskCache" };
    }
    if (hasReasonableTimestamps(norm, durationSec)) {
      fallback = { entries: stripWordTimings(norm), provider: "DiskCache" };
    } else {
      cache.evict(videoId);
    }
  }

  const cleanedTitle = cleanTitle(title);
  const cleanedArtist = cleanArtist(artist);
  const startedAt = Date.now();
  const enabledStates = parseProviderEnabledStates(getSettingValue(SETTINGS.LYRICS_PROVIDER_ENABLED_STATES));
  const providers = getEnabledProviders(getSettingValue(SETTINGS.LYRICS_PROVIDER_ORDER), enabledStates);

  for (const provider of providers) {
    if (Date.now() - startedAt > TOTAL_TIMEOUT_MS) break;
    const cd = cooldowns.get(provider.name) ?? 0;
    if (cd > Date.now()) continue;

    try {
      const raw = await withTimeout(
        provider.getLyrics(videoId, cleanedTitle, cleanedArtist, durationSec, album),
        PROVIDER_TIMEOUT_MS,
      );
      if (!raw || raw.length === 0) continue;

      const entries = filterCreditLines(normalizeEntries(sorted(raw)));
      if (!hasReasonableTimestamps(entries, durationSec)) continue;

      if (entriesAreSynced(entries)) {
        cache.setMemory(videoId, entries);
        cache.setDisk(videoId, entries);
        return { entries, provider: provider.name };
      }
      if (!fallback) {
        cache.setDisk(videoId, entries);
        fallback = { entries, provider: provider.name };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isAuthFailure(msg)) cooldowns.set(provider.name, Date.now() + COOLDOWN_MS);
    }
  }

  if (fallback) {
    cache.setMemory(videoId, fallback.entries);
    return fallback;
  }

  // Last resort: the plain lyrics saved with the download. Not cached, so a
  // later attempt with a working connection can still find a synced version.
  const offline = getOfflineLyrics(videoId);
  if (offline) return { entries: offline, provider: "Downloaded" };

  return null;
}
