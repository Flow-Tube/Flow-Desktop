import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauriEnv } from "./env";
import { invokeBackend } from "./errors";

/** Which AiSList list a channel is on, after the viewer's switches and exemptions. */
export type AiVerdict = "none" | "warn" | "block";

/** How much of the list this computer holds, for the Settings status row. */
export interface AiListStatus {
  channelCount: number;
  /** Epoch ms the list last changed here. */
  updatedAtMs: number;
  version: number;
}

export type AiListOutcome =
  | "notModified"
  | "upToDate"
  | "snapshot"
  | "deltas"
  | "fallbackSnapshot"
  | "refused"
  | "retry";

export interface AiListRefresh {
  /** Null when both switches are off, so nothing was asked. */
  outcome: AiListOutcome | null;
  status: AiListStatus | null;
}

export interface AiListEntries {
  /** Normalized handles, without `@`. */
  handles: string[];
  ids: string[];
}

/** The list and the channel handles learned so far, for the cards' own matcher. */
export interface AiListMatcherData {
  version: number;
  block: AiListEntries;
  warn: AiListEntries;
  /** `[channelId, normalizedHandle]`, least recently used first. */
  index: [string, string][];
}

/** A channel as a card or page shows it. */
export interface AiChannelRef {
  channelId: string;
  handle?: string | null;
}

/** What Settings stores for a list source: no URL means Flow's own. */
export interface AiListSourceSettings {
  url: string | null;
  key: string | null;
}

/** What a report would be about, worked out before the viewer confirms it. */
export type AiReportCheck =
  | { kind: "ready"; handle: string }
  | { kind: "alreadyListed"; verdict: Exclude<AiVerdict, "none"> }
  | { kind: "noName" }
  | { kind: "noHandle" };

export type AiReportResult = "sent" | "busy" | "rateLimited" | "rejected" | "failed";

/** Emitted by the backend after a refresh stored a new list. */
const AI_LIST_UPDATED_EVENT = "ai-list://updated";

export async function getAiListStatus(): Promise<AiListStatus | null> {
  if (!(await isTauriEnv())) return null;
  return invokeBackend<AiListStatus | null>("ai_list_status");
}

export async function refreshAiListNow(): Promise<AiListRefresh> {
  if (!(await isTauriEnv())) return { outcome: null, status: null };
  return invokeBackend<AiListRefresh>("ai_list_refresh");
}

export async function getAiListMatcherData(): Promise<AiListMatcherData | null> {
  if (!(await isTauriEnv())) return null;
  return invokeBackend<AiListMatcherData | null>("ai_list_matcher_data");
}

export async function learnAiChannelHandles(channels: AiChannelRef[]): Promise<void> {
  if (channels.length === 0 || !(await isTauriEnv())) return;
  return invokeBackend<void>("ai_list_learn_handles", { channels });
}

export async function matchAiChannels(channels: AiChannelRef[]): Promise<AiVerdict[]> {
  if (!(await isTauriEnv())) return channels.map(() => "none");
  return invokeBackend<AiVerdict[]>("ai_list_match_channels", { channels });
}

/** Null when the URL is not https or the key is not an Ed25519 public key. */
export async function aiListSourceSettings(url: string, key: string): Promise<AiListSourceSettings | null> {
  if (!(await isTauriEnv())) return null;
  return invokeBackend<AiListSourceSettings | null>("ai_list_source_settings", { url, key });
}

export async function checkAiReport(channelId: string, handle?: string | null): Promise<AiReportCheck> {
  if (!(await isTauriEnv())) return { kind: "noHandle" };
  return invokeBackend<AiReportCheck>("ai_list_check_report", { channelId, handle: handle ?? null });
}

export async function submitAiReport(handle: string, videoId: string): Promise<AiReportResult> {
  if (!(await isTauriEnv())) return "failed";
  return invokeBackend<AiReportResult>("ai_list_submit_report", { handle, videoId });
}

export async function onAiListUpdated(callback: () => void): Promise<UnlistenFn> {
  if (!(await isTauriEnv())) return () => {};
  return listen(AI_LIST_UPDATED_EVENT, () => callback());
}
