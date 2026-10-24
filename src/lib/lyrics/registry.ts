import type { LyricsProvider } from "./types";
import { betterLyricsProvider } from "./providers/betterLyrics";
import { lyricsPlusProvider } from "./providers/lyricsPlus";
import { simpMusicProvider } from "./providers/simpMusic";
import { kugouProvider } from "./providers/kugou";
import { paxsenixProvider } from "./providers/paxsenix";
import { lrclibProvider } from "./providers/lrclib";
import { youtubeProvider } from "./providers/youtube";
import { DEFAULT_PROVIDER_ORDER, resolveProviderOrder } from "./providerOrder";

const PROVIDER_MAP = new Map<string, LyricsProvider>(
  [
    betterLyricsProvider,
    lyricsPlusProvider,
    simpMusicProvider,
    kugouProvider,
    paxsenixProvider,
    lrclibProvider,
    youtubeProvider,
  ].map((provider) => [provider.name, provider]),
);

export type LyricsProviderEnabledStates = Record<string, boolean>;

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
  return JSON.stringify(Object.fromEntries(DEFAULT_PROVIDER_ORDER.map((name) => [name, states[name] ?? true])));
}

export function getEnabledProviders(orderString = "", enabledStates: LyricsProviderEnabledStates = {}): LyricsProvider[] {
  return getOrderedProviders(orderString).filter((provider) => enabledStates[provider.name] !== false);
}
