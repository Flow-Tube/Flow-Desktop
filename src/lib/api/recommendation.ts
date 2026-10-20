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

export interface FeedQuotas {
  maturity: "cold_start" | "maturing" | "mature" | string;
  totalInteractions: number;
  subscriptionPercent: number;
  discoveryPercent: number;
  viralPercent: number;
  subscriptionLimit: number;
  discoveryLimit: number;
  viralLimit: number;
}

const MOCK_FEED_QUOTAS: FeedQuotas = {
  maturity: "mature",
  totalInteractions: 168,
  subscriptionPercent: 10 / 35,
  discoveryPercent: 15 / 35,
  viralPercent: 10 / 35,
  subscriptionLimit: 10,
  discoveryLimit: 15,
  viralLimit: 10,
};

export async function rankVideos(
  candidates: VideoSummary[],
  userSubs: string[],
): Promise<VideoSummary[]> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning candidates with mock ranking.");
    return [...candidates].sort(() => 0.5 - Math.random());
  }
  return invokeBackend<VideoSummary[]>("rank_videos", { candidates, userSubs });
}

export async function getFeedQuotas(): Promise<FeedQuotas> {
  if (!(await isTauriEnv())) {
    return MOCK_FEED_QUOTAS;
  }
  return invokeBackend<FeedQuotas>("get_feed_quotas");
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

export async function generateDiscoveryQueries(): Promise<string[]> {
  if (!(await isTauriEnv())) {
    const preferred = localStorage.getItem("mock_setting_preferred_topics");
    const topics: string[] = preferred ? JSON.parse(preferred) : [];
    if (topics.length > 0) {
      return topics.slice(0, 5).map((topic) => topic.toLowerCase());
    }
    return ["technology", "music", "gaming", "science", "documentary"];
  }
  return invokeBackend<string[]>("generate_discovery_queries");
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

const MOCK_BRAIN: UserBrain = {
  time_vectors: {
    "WeekdayMorning": {
      topics: { "Coding": 0.8, "Tech News": 0.6, "Acoustic": 0.4 },
      topic_confidence: {},
      anchor_topics: [],
      duration: 0.35,
      pacing: 0.3,
      complexity: 0.75,
      is_live: 0.0
    },
    "WeekdayEvening": {
      topics: { "Gaming": 0.7, "Chill Lofi": 0.8, "Pop Culture": 0.5 },
      topic_confidence: {},
      anchor_topics: [],
      duration: 0.45,
      pacing: 0.4,
      complexity: 0.45,
      is_live: 0.1
    }
  },
  global_vector: {
    topics: {
      "Coding": 0.85,
      "TypeScript": 0.72,
      "React": 0.68,
      "Lofi Beats": 0.64,
      "Astrophysics": 0.58,
      "Space Tech": 0.52,
      "Synthwave": 0.48,
      "System Architecture": 0.62,
      "Documentaries": 0.45,
      "Rust Language": 0.75
    },
    topic_confidence: {},
    anchor_topics: [],
    duration: 0.48,
    pacing: 0.32,
    complexity: 0.78,
    is_live: 0.05
  },
  channel_scores: {
    "UCsBjURrdUw78urAxx45z2eg": 0.95,
    "UC3sELt4nY_Msu7881_oIiCw": 0.82,
    "UCeVMnSShP_Iviwkknt83cww": 0.88,
    "UCvn_XCl_mBa1dPf0uVaMglA": 0.45,
    "UCXuqSBlHAE6Xw-yeJA0Tunw": 0.72
  },
  topic_affinities: {
    "coding:typescript": 0.85,
    "coding:rust": 0.9,
    "space:astrophysics": 0.78
  },
  total_interactions: 168,
  consecutive_skips: 0,
  blocked_topics: ["gossip", "clickbait sensationalism", "celebrity drama"],
  blocked_channels: ["UC_blocked_channel_123"],
  preferred_topics: ["Coding", "Technology", "Ambient Music", "Astrophysics"],
  has_completed_onboarding: true,
  last_persona: "Silicon Alchemist",
  persona_stability: 18,
  idf_word_frequency: {},
  idf_total_documents: 168,
  watch_signal_progress: {},
  watch_history_map: {
    "vid1": 0.95,
    "vid2": 1.0,
    "vid3": 0.2
  },
  channel_topic_profiles: {
    "UCsBjURrdUw78urAxx45z2eg": { "Coding": 0.9, "Tech News": 0.8 }
  },
  suppressed_video_ids: {},
  suppressed_channels: {},
  rejection_patterns: {
    "drama": { count: 3, last_rejected_at: Date.now() - 3600000 }
  },
  feed_history: {
    "vid1": { last_shown: Date.now() - 5000, show_count: 2 }
  },
  recent_query_tokens: [],
  topic_evidence: {
    "Coding": {
      positive_signals: 45,
      negative_signals: 1,
      watch_signals: 38,
      explicit_signals: 4,
      positive_score: 18.5,
      video_ids: ["vid_code_1", "vid_code_2"],
      channel_ids: ["UCsBjURrdUw78urAxx45z2eg"],
      first_seen_at: Date.now() - 10 * 24 * 3600000,
      last_seen_at: Date.now() - 30 * 60000
    },
    "Rust Language": {
      positive_signals: 28,
      negative_signals: 0,
      watch_signals: 24,
      explicit_signals: 2,
      positive_score: 12.2,
      video_ids: ["vid_rust_1"],
      channel_ids: ["UCeVMnSShP_Iviwkknt83cww"],
      first_seen_at: Date.now() - 8 * 24 * 3600000,
      last_seen_at: Date.now() - 60 * 60000
    },
    "Astrophysics": {
      positive_signals: 15,
      negative_signals: 3,
      watch_signals: 12,
      explicit_signals: 1,
      positive_score: 6.4,
      video_ids: ["vid_astro_1"],
      channel_ids: ["UCXuqSBlHAE6Xw-yeJA0Tunw"],
      first_seen_at: Date.now() - 5 * 24 * 3600000,
      last_seen_at: Date.now() - 120 * 60000
    }
  },
  schema_version: 1
};

let brainCache: UserBrain | null = null;
let brainCacheTime = 0;

export async function getBrainSnapshot(forceRefresh?: boolean): Promise<UserBrain> {
  const now = Date.now();
  if (!forceRefresh && brainCache && now - brainCacheTime < 60000) {
    return brainCache;
  }

  if (!(await isTauriEnv())) {
    const preferred = localStorage.getItem("mock_setting_preferred_topics");
    const topics: string[] = preferred ? JSON.parse(preferred) : [];
    
    const mockCopy = JSON.parse(JSON.stringify(MOCK_BRAIN));
    if (topics.length > 0) {
      mockCopy.preferred_topics = topics;
      mockCopy.global_vector.topics = {};
      topics.forEach((t, i) => {
        mockCopy.global_vector.topics[t] = 0.9 - i * 0.1;
      });
    }
    brainCache = mockCopy;
    brainCacheTime = now;
    return mockCopy;
  }

  try {
    const result = await invokeBackend<UserBrain>("get_brain_snapshot");
    brainCache = result;
    brainCacheTime = now;
    return result;
  } catch (err) {
    console.error("Failed to load brain snapshot from Tauri, using mock fallback:", err);
    return MOCK_BRAIN;
  }
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

export async function blockChannel(channelId: string): Promise<void> {
  if (!(await isTauriEnv())) {
    console.log(`[FlowNeuro Mock] Blocking channel: ${channelId}`);
    return;
  }
  await invokeBackend<void>("block_channel", { channelId });
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
