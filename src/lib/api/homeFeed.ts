import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeBackend } from "./errors";
import { isTauriEnv } from "./env";
import type { VideoSummary } from "../../types/video";

export type HomeOriginKind = "subscription" | "related" | "search" | "channelMemory" | "neighbour";

/** Why a card is on Home. A neighbour's detail holds up to two channel names joined by "|". */
export interface HomeOrigin {
  kind: HomeOriginKind;
  detail?: string;
}

export interface HomeCard extends VideoSummary {
  publishedAtMs: number;
}

export interface HomeSnapshot {
  generation: number;
  cards: HomeCard[];
  origins: Record<string, HomeOrigin>;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMoreFailed: boolean;
  error: string | null;
}

export const EMPTY_HOME_SNAPSHOT: HomeSnapshot = {
  generation: 0,
  cards: [],
  origins: {},
  loading: false,
  loadingMore: false,
  hasMore: false,
  loadMoreFailed: false,
  error: null,
};

export async function openHomeFeed(): Promise<HomeSnapshot> {
  if (!(await isTauriEnv())) return EMPTY_HOME_SNAPSHOT;
  return invokeBackend<HomeSnapshot>("home_feed_open");
}

export async function refreshHomeFeed(): Promise<HomeSnapshot> {
  if (!(await isTauriEnv())) return EMPTY_HOME_SNAPSHOT;
  return invokeBackend<HomeSnapshot>("home_feed_refresh");
}

export async function reportHomeViewport(lastVisible: number): Promise<void> {
  if (!(await isTauriEnv())) return;
  await invokeBackend<void>("home_feed_viewport", { lastVisible });
}

export async function setHomeFeedVisible(visible: boolean): Promise<void> {
  if (!(await isTauriEnv())) return;
  await invokeBackend<void>("home_feed_visible", { visible });
}

export async function retryHomeLoadMore(): Promise<void> {
  if (!(await isTauriEnv())) return;
  await invokeBackend<void>("home_feed_retry_more");
}

/** Forgets Home's feed and caches, so the next visit is ranked by the brain as it is now. */
export async function clearHomeFeed(): Promise<void> {
  if (!(await isTauriEnv())) return;
  await invokeBackend<void>("home_feed_clear");
}

export async function onHomeFeedChanged(handler: (snapshot: HomeSnapshot) => void): Promise<UnlistenFn> {
  if (!(await isTauriEnv())) return () => {};
  return listen<HomeSnapshot>("home-feed", (event) => handler(event.payload));
}

/** One of the viewer's heaviest interests, named after the topic of it they watched most. */
export interface InterestChip {
  key: string;
  label: string;
  topics: string[];
  /** A theme chip's category ("gaming", "science"), which names it. */
  category: string | null;
  parts: InterestChip[];
}

export interface ChipFeed {
  cards: HomeCard[];
  failed: boolean;
}

export async function getHomeChips(): Promise<InterestChip[]> {
  if (!(await isTauriEnv())) return [];
  return invokeBackend<InterestChip[]>("home_feed_chips");
}

/** A chip's own videos: `interest:<key>`, `new` or `recent`. */
export async function getHomeChipFeed(key: string, refresh: boolean): Promise<ChipFeed> {
  if (!(await isTauriEnv())) return { cards: [], failed: false };
  return invokeBackend<ChipFeed>("home_chip_feed", { key, refresh });
}
