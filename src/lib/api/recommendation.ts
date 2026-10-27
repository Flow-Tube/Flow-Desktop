import type { VideoSummary } from "../../types/video";
import { isDeepFlowCurrentlyActive } from "../deepFlow";
import { isTauriEnv } from "./env";
import { invokeBackend } from "./errors";

export interface PersonaDetails {
  name: string;
  title: string;
  description: string;
  icon: string;
}

/** Below this a topic is a trace of evidence still adding up, not an interest to show. */
export const INTEREST_MIN_WEIGHT = 0.03;

/** The topics of a taste vector strong enough to be interests. */
export function interestTopics(topics: Record<string, number> | undefined): Record<string, number> {
  return Object.fromEntries(
    Object.entries(topics ?? {}).filter(([, weight]) => weight >= INTEREST_MIN_WEIGHT),
  );
}

export interface RecommendationEvent {
  id: number | null;
  eventType: string;
  videoId: string | null;
  channelName: string | null;
  query: string | null;
  value: number | null;
  createdAt: string;
}

export async function getRecommendationEvents(limit = 50): Promise<RecommendationEvent[]> {
  if (!(await isTauriEnv())) {
    return [];
  }
  return invokeBackend<RecommendationEvent[]>("get_recommendation_events", { limit });
}

export async function logInteraction(
  videoId: string,
  title: string,
  channelName: string,
  channelId: string,
  description: string | null,
  durationSeconds: number | null,
  isLive: boolean,
  isShort: boolean,
  interactionType: string,
  percentWatched: number,
): Promise<void> {
  if (isDeepFlowCurrentlyActive()) return;

  if (!(await isTauriEnv())) {
    console.log(`[FlowNeuro Mock Log] ${interactionType} - ${title} (${percentWatched * 100}%)`);
    return;
  }
  return invokeBackend<void>("log_interaction", {
    videoId,
    title,
    channelName,
    channelId,
    description,
    durationSeconds,
    isLive,
    isShort,
    interactionType,
    percentWatched,
  });
}

/** What the player reports about the video it is playing; see `report_watch_progress`. */
export interface WatchReport {
  videoId: string;
  title: string;
  channelName: string;
  channelId: string;
  description: string | null;
  isLive: boolean;
  isMusic: boolean;
  category: string | null;
  position: number;
  duration: number;
  playedDelta: number;
}

/** Feeds the backend watch session. It turns a whole viewing into one click and one watch or skip. */
export async function reportWatchProgress(report: WatchReport): Promise<void> {
  if (isDeepFlowCurrentlyActive() || !(await isTauriEnv())) return;
  return invokeBackend<void>("report_watch_progress", { report });
}

/** `natural` is a video that played to its end; any other end waits briefly for the video to resume. */
export async function endWatchSession(report: WatchReport, natural: boolean): Promise<void> {
  if (isDeepFlowCurrentlyActive() || !(await isTauriEnv())) return;
  return invokeBackend<void>("end_watch_session", { report, natural });
}

export async function markNotInterested(
  videoId: string,
  title: string,
  channelName: string,
  channelId: string,
  description: string | null,
  durationSeconds: number | null,
  isLive: boolean,
  isShort: boolean,
): Promise<void> {
  if (isDeepFlowCurrentlyActive()) return;

  if (!(await isTauriEnv())) {
    console.log(`[FlowNeuro Mock] Not interested - ${title}`);
    return;
  }
  return invokeBackend<void>("mark_not_interested", {
    videoId,
    title,
    channelName,
    channelId,
    description,
    durationSeconds,
    isLive,
    isShort,
  });
}

/** Cards seen beside a video, kept only for "Hide videos you've already seen". */
export async function recordSeenVideos(ids: string[]): Promise<void> {
  if (isDeepFlowCurrentlyActive() || !(await isTauriEnv())) return;
  return invokeBackend<void>("record_seen_videos", { ids });
}

/** Which of these videos were already seen in a recommendation list. */
export async function seenVideoIdsAmong(ids: string[]): Promise<string[]> {
  if (!(await isTauriEnv())) return [];
  return invokeBackend<string[]>("seen_video_ids_among", { ids });
}

export async function recordFeedImpressions(
  videos: VideoSummary[],
): Promise<void> {
  if (isDeepFlowCurrentlyActive()) return;

  if (!(await isTauriEnv())) {
    return;
  }
  return invokeBackend<void>("record_feed_impressions", { videos });
}

export async function completeOnboarding(preferred: string[]): Promise<void> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Setting onboarding complete in local storage.");
    localStorage.setItem("mock_setting_onboarded", "true");
    localStorage.setItem("mock_setting_preferred_topics", JSON.stringify(preferred));
    return;
  }
  return invokeBackend<void>("complete_onboarding", { topics: preferred });
}

export async function getOnboardingStatus(): Promise<boolean> {
  if (!(await isTauriEnv())) {
    const status = localStorage.getItem("mock_setting_onboarded") === "true";
    console.log("[FlowNeuro Mock Onboarding Status Check]", status);
    return status;
  }
  return invokeBackend<boolean>("get_onboarding_status");
}

export async function getFlowPersona(): Promise<PersonaDetails> {
  if (!(await isTauriEnv())) {
    const preferred = localStorage.getItem("mock_setting_preferred_topics");
    const topics: string[] = preferred ? JSON.parse(preferred) : [];
    
    if (topics.some((t) => ["Coding", "Technology", "Programming"].includes(t))) {
      return {
        name: "TECH_ENGINEER",
        title: "💻 Silicon Alchemist",
        description: "Your local recommendation brain indicates you are heavily inclined towards software engineering, machine learning, and system structures.",
        icon: "💻",
      };
    }
    return {
      name: "COSMIC_EXPLORER",
      title: "🌌 Cosmic Navigator",
      description: "You exhibit high affinity towards sciences, astrophysics, history, and acoustic ambient music sessions.",
      icon: "🌌",
    };
  }
  return invokeBackend<PersonaDetails>("get_flow_persona");
}

export interface ContentVector {
  topics: Record<string, number>;
  topic_confidence: Record<string, number>;
  anchor_topics: string[];
  duration: number;
  pacing: number;
  complexity: number;
  is_live: number;
}

export interface RejectionSignal {
  count: number;
  last_rejected_at: number;
}

export interface FeedEntry {
  last_shown: number;
  show_count: number;
}

export interface TopicEvidence {
  positive_signals: number;
  negative_signals: number;
  watch_signals: number;
  explicit_signals: number;
  positive_score: number;
  video_ids: string[];
  channel_ids: string[];
  first_seen_at: number;
  last_seen_at: number;
}

export interface DisplayForm {
  form: string;
  votes: number;
}

export interface UserBrain {
  time_vectors: Record<string, ContentVector>;
  global_vector: ContentVector;
  channel_scores: Record<string, number>;
  topic_affinities: Record<string, number>;
  total_interactions: number;
  consecutive_skips: number;
  blocked_topics: string[];
  blocked_channels: string[];
  preferred_topics: string[];
  has_completed_onboarding: boolean;
  last_persona: string | null;
  persona_stability: number;
  idf_word_frequency: Record<string, number>;
  idf_total_documents: number;
  watch_signal_progress: Record<string, number>;
  watch_history_map: Record<string, number>;
  channel_topic_profiles: Record<string, Record<string, number>>;
  suppressed_video_ids: Record<string, number>;
  suppressed_channels: Record<string, number>;
  rejection_patterns: Record<string, RejectionSignal>;
  feed_history: Record<string, FeedEntry>;
  recent_query_tokens: string[][];
  topic_evidence: Record<string, TopicEvidence>;
  schema_version: number;
  language_profile?: string | null;
  key_language?: string | null;
  key_spec?: number;
  /** How titles write the keys that are spelled differently from the key. */
  display_forms?: Record<string, DisplayForm>;
}

function emptyContentVector(): ContentVector {
  return { topics: {}, topic_confidence: {}, anchor_topics: [], duration: 0.5, pacing: 0.5, complexity: 0.5, is_live: 0 };
}

/** What the browser-only dev build shows: an empty brain, never invented interests. */
function emptyBrain(): UserBrain {
  return {
    time_vectors: {},
    global_vector: emptyContentVector(),
    channel_scores: {},
    topic_affinities: {},
    total_interactions: 0,
    consecutive_skips: 0,
    blocked_topics: [],
    blocked_channels: [],
    preferred_topics: [],
    has_completed_onboarding: false,
    last_persona: null,
    persona_stability: 0,
    idf_word_frequency: {},
    idf_total_documents: 0,
    watch_signal_progress: {},
    watch_history_map: {},
    channel_topic_profiles: {},
    suppressed_video_ids: {},
    suppressed_channels: {},
    rejection_patterns: {},
    feed_history: {},
    recent_query_tokens: [],
    topic_evidence: {},
    schema_version: 1,
  };
}

let brainCache: UserBrain | null = null;
let brainCacheTime = 0;

export async function getBrainSnapshot(forceRefresh?: boolean): Promise<UserBrain> {
  const now = Date.now();
  if (!forceRefresh && brainCache && now - brainCacheTime < 60000) {
    return brainCache;
  }

  if (!(await isTauriEnv())) {
    const preferred = localStorage.getItem("mock_setting_preferred_topics");
    const brain = emptyBrain();
    brain.preferred_topics = preferred ? JSON.parse(preferred) : [];
    brainCache = brain;
    brainCacheTime = now;
    return brain;
  }

  const result = await invokeBackend<UserBrain>("get_brain_snapshot");
  brainCache = result;
  brainCacheTime = now;
  return result;
}

/** A typed search is the most explicit interest statement there is; it teaches the engine once. */
export async function learnFromSearch(query: string): Promise<void> {
  if (!query.trim() || isDeepFlowCurrentlyActive() || !(await isTauriEnv())) return;
  await invokeBackend<boolean>("learn_from_search", { query });
  brainCache = null;
}

/** Following a channel lifts it and teaches its name; unfollowing returns it to neutral. */
export async function noteSubscription(
  channelId: string,
  channelName: string,
  subscribed: boolean,
): Promise<void> {
  if (isDeepFlowCurrentlyActive() || !(await isTauriEnv())) return;
  await invokeBackend<void>("note_subscription", { channelId, channelName, subscribed });
}

/** Upload titles a feed already fetched say what each channel is about. */
export async function observeChannelUploads(uploads: VideoSummary[]): Promise<void> {
  if (uploads.length === 0 || isDeepFlowCurrentlyActive() || !(await isTauriEnv())) return;
  await invokeBackend<void>("observe_channel_uploads", { uploads });
}

/** One imported watch-history entry the engine can learn from. */
export interface ImportedVideo {
  videoId: string;
  title: string;
  channelName: string;
  channelId: string | null;
  durationSeconds: number | null;
  watchedAt: number;
  isMusic: boolean;
}

/** Learns gently from an imported history: newest first, no music, capped per channel. */
export async function bootstrapFromHistory(videos: ImportedVideo[]): Promise<number> {
  if (videos.length === 0 || !(await isTauriEnv())) return 0;
  const learned = await invokeBackend<number>("bootstrap_from_history", { videos });
  brainCache = null;
  return learned;
}

/** Seeds topics from imported subscription names when the brain has not learned yet. */
export async function bootstrapFromSubscriptions(channelNames: string[]): Promise<number> {
  if (channelNames.length === 0 || !(await isTauriEnv())) return 0;
  const seeded = await invokeBackend<number>("bootstrap_from_subscriptions", { channelNames });
  brainCache = null;
  return seeded;
}

/** Makes an imported brain the engine's own; the backend checks it and converts its keys. */
export async function importBrain(brain: unknown): Promise<void> {
  if (!(await isTauriEnv())) return;
  await invokeBackend<void>("import_brain", { brain });
  brainCache = null;
}

export async function unblockTopic(topic: string): Promise<void> {
  if (!(await isTauriEnv())) {
    console.log(`[FlowNeuro Mock] Unblocking topic: ${topic}`);
    if (brainCache) {
      brainCache.blocked_topics = brainCache.blocked_topics.filter(t => t !== topic);
    }
    return;
  }
  await invokeBackend<void>("unblock_topic", { topic });
  brainCache = null;
}

export async function addBlockedTopic(topic: string): Promise<void> {
  const normalized = topic.trim().toLowerCase();
  if (!normalized) return;
  if (!(await isTauriEnv())) {
    console.log(`[FlowNeuro Mock] Blocking topic: ${normalized}`);
    if (brainCache) {
      brainCache.blocked_topics = [...new Set([...brainCache.blocked_topics, normalized])];
      brainCache.preferred_topics = brainCache.preferred_topics.filter(
        (t) => t.toLowerCase() !== normalized,
      );
    }
    return;
  }
  await invokeBackend<void>("add_blocked_topic", { topic: normalized });
  brainCache = null;
}

export async function addPreferredTopic(topic: string): Promise<void> {
  const trimmed = topic.trim();
  if (!trimmed) return;
  if (!(await isTauriEnv())) {
    console.log(`[FlowNeuro Mock] Adding preferred topic: ${trimmed}`);
    if (brainCache) {
      brainCache.preferred_topics = [...new Set([...brainCache.preferred_topics, trimmed])];
      brainCache.blocked_topics = brainCache.blocked_topics.filter(
        (t) => t.toLowerCase() !== trimmed.toLowerCase(),
      );
      brainCache.global_vector.topics[trimmed] = 0.5;
    }
    localStorage.setItem(
      "mock_setting_preferred_topics",
      JSON.stringify(brainCache?.preferred_topics ?? [trimmed]),
    );
    return;
  }
  await invokeBackend<void>("add_preferred_topic", { topic: trimmed });
  brainCache = null;
}

export async function removePreferredTopic(topic: string): Promise<void> {
  const normalized = topic.trim().toLowerCase();
  if (!normalized) return;
  if (!(await isTauriEnv())) {
    console.log(`[FlowNeuro Mock] Removing preferred topic: ${topic}`);
    if (brainCache) {
      brainCache.preferred_topics = brainCache.preferred_topics.filter(
        (t) => t.toLowerCase() !== normalized,
      );
      localStorage.setItem("mock_setting_preferred_topics", JSON.stringify(brainCache.preferred_topics));
    }
    return;
  }
  await invokeBackend<void>("remove_preferred_topic", { topic });
  brainCache = null;
}

export async function unblockChannel(channelId: string): Promise<void> {
  if (!(await isTauriEnv())) {
    console.log(`[FlowNeuro Mock] Unblocking channel: ${channelId}`);
    if (brainCache) {
      brainCache.blocked_channels = brainCache.blocked_channels.filter(c => c !== channelId);
    }
    return;
  }
  await invokeBackend<void>("unblock_channel", { channelId });
  brainCache = null;
}

/** Blocks a channel; its name is kept so Hidden channels can show it without a lookup. */
export async function blockChannel(channelId: string, channelName?: string): Promise<void> {
  if (!(await isTauriEnv())) {
    console.log(`[FlowNeuro Mock] Blocking channel: ${channelId}`);
    return;
  }
  await invokeBackend<void>("block_channel", { channelId, channelName: channelName || null });
  brainCache = null;
}

export async function resetBrain(): Promise<void> {
  if (!(await isTauriEnv())) {
    console.log(`[FlowNeuro Mock] Resetting brain`);
    localStorage.removeItem("mock_setting_onboarded");
    localStorage.removeItem("mock_setting_preferred_topics");
    brainCache = null;
    return;
  }
  await invokeBackend<void>("reset_brain");
  brainCache = null;
}

export interface TasteTopic {
  key: string;
  /** As titles write it; what a boost stores. */
  label: string;
  /** How often the viewer watched, liked or searched it. */
  evidence: number;
}

export interface TasteGroup {
  id: string;
  label: string;
  /** Relative to the strongest group, 0 to 1. */
  share: number;
  evidence: number;
  members: TasteTopic[];
}

export interface NamedChannel {
  id: string;
  /** Empty when this device knows no name for it. */
  name: string;
}

export interface TasteOverview {
  picks: TasteTopic[];
  groups: TasteGroup[];
  hiddenChannels: NamedChannel[];
  /** Channels watched often without following, which Home draws uploads from. */
  rememberedChannels: NamedChannel[];
}

/** Home stops drawing on the channel until the viewer watches it again. */
export async function forgetRememberedChannel(channelId: string): Promise<void> {
  if (!(await isTauriEnv())) return;
  await invokeBackend<void>("forget_remembered_channel", { channelId });
}

/** Forgets every channel watched often; channels turned down stay turned down. */
export async function clearChannelMemory(): Promise<void> {
  if (!(await isTauriEnv())) return;
  await invokeBackend<void>("clear_channel_memory");
}

/** Names of hidden channels this device does not know, from their RSS feeds. */
export async function resolveHiddenChannelNames(channelIds: string[]): Promise<Record<string, string>> {
  if (channelIds.length === 0 || !(await isTauriEnv())) return {};
  return invokeBackend<Record<string, string>>("resolve_hidden_channel_names", { channelIds });
}

export async function getTasteOverview(): Promise<TasteOverview> {
  if (!(await isTauriEnv())) return { picks: [], groups: [], hiddenChannels: [], rememberedChannels: [] };
  return invokeBackend<TasteOverview>("get_taste_overview");
}
