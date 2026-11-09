import type { LyricsProvider } from "./types";
import { betterLyricsProvider } from "./providers/betterLyrics";
import { lyricsPlusProvider } from "./providers/lyricsPlus";
import { simpMusicProvider } from "./providers/simpMusic";
import { kugouProvider } from "./providers/kugou";
import { paxsenixProvider } from "./providers/paxsenix";
import { lrclibProvider } from "./providers/lrclib";
import { youtubeProvider } from "./providers/youtube";
import { youtubeCaptionsProvider } from "./providers/youtubeCaptions";
import { amllProvider } from "./providers/amll";
import { neteaseProvider } from "./providers/netease";
import { lrcRedProvider } from "./providers/lrcRed";
import { unisonProvider } from "./providers/unison";
import { DEFAULT_PROVIDER_ORDER, resolveProviderOrder } from "./providerOrder";

const PROVIDER_MAP = new Map<string, LyricsProvider>(
  [
    betterLyricsProvider,
    lrcRedProvider,
    lyricsPlusProvider,
    simpMusicProvider,
    kugouProvider,
    paxsenixProvider,
    lrclibProvider,
    unisonProvider,
    neteaseProvider,
    amllProvider,
    youtubeCaptionsProvider,
    youtubeProvider,
  ].map((provider) => [provider.name, provider]),
);

export type LyricsProviderEnabledStates = Record<string, boolean>;

/**
 * Sources that start switched off. YouTube now refuses the transcript request every song's
 * captions came from (Android's too), so that source waits until the new flow is ported.
 */
const OFF_BY_DEFAULT = new Set(["YouTubeSubtitle"]);

/** Whether a source runs: the listener's choice, or its default when they never made one. */
export function isProviderEnabled(states: LyricsProviderEnabledStates, name: string): boolean {
  return states[name] ?? !OFF_BY_DEFAULT.has(name);
}

export function getOrderedProviders(orderString = ""): LyricsProvider[] {
  return resolveProviderOrder(orderString)
    .map((name) => PROVIDER_MAP.get(name))
    .filter((provider): provider is LyricsProvider => !!provider);
}

export function parseProviderEnabledStates(raw: string | null | undefined): LyricsProviderEnabledStates {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([name, value]) => PROVIDER_MAP.has(name) && typeof value === "boolean",
      ),
    );
  } catch {
    return {};
  }
}

export function serializeProviderEnabledStates(states: LyricsProviderEnabledStates): string {
  return JSON.stringify(Object.fromEntries(DEFAULT_PROVIDER_ORDER.map((name) => [name, isProviderEnabled(states, name)])));
}

export function getEnabledProviders(orderString = "", enabledStates: LyricsProviderEnabledStates = {}): LyricsProvider[] {
  return getOrderedProviders(orderString).filter((provider) => isProviderEnabled(enabledStates, provider.name));
}
