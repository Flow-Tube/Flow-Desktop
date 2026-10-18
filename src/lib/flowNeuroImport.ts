import type { ContentVector, DisplayForm, UserBrain } from "./api/recommendation";

const TIME_BUCKETS = [
  "WeekdayMorning",
  "WeekdayAfternoon",
  "WeekdayEvening",
  "WeekdayNight",
  "WeekendMorning",
  "WeekendAfternoon",
  "WeekendEvening",
  "WeekendNight",
] as const;

const TIME_BUCKET_MAP: Record<string, string> = {
  WEEKDAY_MORNING: "WeekdayMorning",
  WEEKDAY_AFTERNOON: "WeekdayAfternoon",
  WEEKDAY_EVENING: "WeekdayEvening",
  WEEKDAY_NIGHT: "WeekdayNight",
  WEEKEND_MORNING: "WeekendMorning",
  WEEKEND_AFTERNOON: "WeekendAfternoon",
  WEEKEND_EVENING: "WeekendEvening",
  WEEKEND_NIGHT: "WeekendNight",
  WeekdayMorning: "WeekdayMorning",
  WeekdayAfternoon: "WeekdayAfternoon",
  WeekdayEvening: "WeekdayEvening",
  WeekdayNight: "WeekdayNight",
  WeekendMorning: "WeekendMorning",
  WeekendAfternoon: "WeekendAfternoon",
  WeekendEvening: "WeekendEvening",
  WeekendNight: "WeekendNight",
};

const emptyVector = (): ContentVector => ({
  topics: {},
  topic_confidence: {},
  anchor_topics: [],
  duration: 0.5,
  pacing: 0.5,
  complexity: 0.5,
  is_live: 0.0,
});

const asObject = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

const toNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const toArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>);
  }
  return [];
};

const mapContentVector = (value: unknown): ContentVector => {
  const vector = asObject(value);
  if (Object.keys(vector).length === 0) return emptyVector();

  return {
    topics: asObject(vector.topics),
    topic_confidence: asObject(vector.topicConfidence ?? vector.topic_confidence),
    anchor_topics: toArray(vector.anchorTopics ?? vector.anchor_topics),
    duration: toNumber(vector.duration, 0.5),
    pacing: toNumber(vector.pacing, 0.5),
    complexity: toNumber(vector.complexity, 0.5),
    is_live: toNumber(vector.isLive ?? vector.is_live, 0.0),
  };
};

const mapDisplayForms = (value: unknown): Record<string, DisplayForm> => {
  const output: Record<string, DisplayForm> = {};
  Object.entries(asObject(value)).forEach(([key, raw]) => {
    const entry = asObject(raw);
    if (typeof entry.form === "string") {
      output[key] = { form: entry.form, votes: toNumber(entry.votes, 1) };
    }
  });
  return output;
};

const toLanguage = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

// Flow for Android writes key spec 2 keys from its brain schema 20 on.
const ANDROID_KEY_SPEC_2_SCHEMA = 20;

const mapTopicEvidence = (value: unknown): UserBrain["topic_evidence"] => {
  const input = asObject(value);
  const output: UserBrain["topic_evidence"] = {};

  Object.keys(input).forEach((key) => {
    const evidence = asObject(input[key]);
    output[key] = {
      positive_signals: toNumber(evidence.positiveSignals ?? evidence.positive_signals, 0),
      negative_signals: toNumber(evidence.negativeSignals ?? evidence.negative_signals, 0),
      watch_signals: toNumber(evidence.watchSignals ?? evidence.watch_signals, 0),
      explicit_signals: toNumber(evidence.explicitSignals ?? evidence.explicit_signals, 0),
      positive_score: toNumber(evidence.positiveScore ?? evidence.positive_score, 0.0),
      video_ids: toArray(evidence.videoIds ?? evidence.video_ids),
      channel_ids: toArray(evidence.channelIds ?? evidence.channel_ids),
      first_seen_at: toNumber(evidence.firstSeenAt ?? evidence.first_seen_at, 0),
      last_seen_at: toNumber(evidence.lastSeenAt ?? evidence.last_seen_at, 0),
    };
  });

  return output;
};

export function isFlowNeuroBrainCandidate(value: unknown): boolean {
  const data = asObject(value);
  return Boolean(
    data.global ||
      data.global_vector ||
      data.timeVectors ||
      data.time_vectors ||
      data.channelScores ||
      data.channel_scores ||
      data.topicEvidence ||
      data.topic_evidence ||
      data.user_neuro_brain ||
      data.userNeuroBrain,
  );
}

export function extractFlowNeuroBrainCandidate(value: unknown): unknown | null {
  const data = asObject(value);
  if (isFlowNeuroBrainCandidate(data) && (data.global || data.global_vector || data.timeVectors || data.time_vectors)) {
    return data;
  }

  const wrapped = data.user_neuro_brain ?? data.userNeuroBrain;
  if (typeof wrapped === "string") {
    try {
      const parsed = JSON.parse(wrapped) as unknown;
      return isFlowNeuroBrainCandidate(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return isFlowNeuroBrainCandidate(wrapped) ? wrapped : null;
}

export function convertFlowNeuroBrainData(value: unknown): UserBrain {
  const data = asObject(value);
  const globalVector = mapContentVector(data.global ?? data.global_vector);
  const timeVectors: UserBrain["time_vectors"] = {};
  const inputTimeVectors = asObject(data.timeVectors ?? data.time_vectors);

  TIME_BUCKETS.forEach((bucket) => {
    timeVectors[bucket] = emptyVector();
  });

  Object.keys(inputTimeVectors).forEach((key) => {
    const mappedKey = TIME_BUCKET_MAP[key] ?? key;
    if (TIME_BUCKETS.includes(mappedKey as (typeof TIME_BUCKETS)[number])) {
      timeVectors[mappedKey] = mapContentVector(inputTimeVectors[key]);
    }
  });

  const totalInteractions = toNumber(data.interactions ?? data.total_interactions, 0);
  const preferredTopics = toArray(data.preferredTopics ?? data.preferred_topics);
  const channelScores = asObject(data.channelScores ?? data.channel_scores) as Record<string, number>;
  const topicEvidence = mapTopicEvidence(data.topicEvidence ?? data.topic_evidence);
  const hasImportedSignals =
    totalInteractions > 0 ||
    preferredTopics.length > 0 ||
    Object.keys(globalVector.topics).length > 0 ||
    Object.keys(channelScores).length > 0 ||
    Object.keys(topicEvidence).length > 0;

  const rejectionPatterns: UserBrain["rejection_patterns"] = {};
  Object.entries(asObject(data.rejectionPatterns ?? data.rejection_patterns)).forEach(([key, value]) => {
    const pattern = asObject(value);
    rejectionPatterns[key] = {
      count: toNumber(pattern.count, 0),
      last_rejected_at: toNumber(pattern.lastRejectedAt ?? pattern.last_rejected_at, 0),
    };
  });

  const feedHistory: UserBrain["feed_history"] = {};
  Object.entries(asObject(data.feedHistory ?? data.feed_history)).forEach(([key, value]) => {
    const entry = asObject(value);
    feedHistory[key] = {
      last_shown: toNumber(entry.lastShown ?? entry.last_shown, 0),
      show_count: toNumber(entry.showCount ?? entry.show_count, 0),
    };
  });

  const schemaVersion = toNumber(data.schemaVersion ?? data.schema_version, 13);
  const keySpec = toNumber(
    data.keySpec ?? data.key_spec,
    typeof data.schemaVersion === "number" && data.schemaVersion >= ANDROID_KEY_SPEC_2_SCHEMA ? 2 : 0,
  );

  const recentQueryTokens = Array.isArray(data.recentQueryTokens ?? data.recent_query_tokens)
    ? (data.recentQueryTokens ?? data.recent_query_tokens).map((tokens: unknown) => toArray(tokens))
    : [];

  return {
    schema_version: schemaVersion,
    language_profile: toLanguage(data.languageProfile ?? data.language_profile),
    key_language: toLanguage(data.keyLanguage ?? data.key_language),
    key_spec: keySpec,
    display_forms: mapDisplayForms(data.displayForms ?? data.display_forms),
    time_vectors: timeVectors,
    global_vector: globalVector,
    channel_scores: channelScores,
    topic_affinities: asObject(data.topicAffinities ?? data.topic_affinities) as Record<string, number>,
    total_interactions: totalInteractions,
    consecutive_skips: toNumber(data.consecutiveSkips ?? data.consecutive_skips, 0),
    blocked_topics: toArray(data.blockedTopics ?? data.blocked_topics),
    blocked_channels: toArray(data.blockedChannels ?? data.blocked_channels),
    preferred_topics: preferredTopics,
    has_completed_onboarding: Boolean(data.hasCompletedOnboarding ?? data.has_completed_onboarding ?? false) || hasImportedSignals,
    last_persona:
      typeof (data.lastPersona ?? data.last_persona) === "string"
        ? (data.lastPersona ?? data.last_persona)
        : null,
    persona_stability: toNumber(data.personaStability ?? data.persona_stability, 0),
    idf_word_frequency: asObject(data.idfWordFrequency ?? data.idf_word_frequency) as Record<string, number>,
    idf_total_documents: toNumber(data.idfTotalDocuments ?? data.idf_total_documents, 0),
    watch_signal_progress: asObject(data.watchSignalProgress ?? data.watch_signal_progress) as Record<string, number>,
    watch_history_map: asObject(data.watchHistoryMap ?? data.watch_history_map) as Record<string, number>,
    channel_topic_profiles: asObject(data.channelTopicProfiles ?? data.channel_topic_profiles) as Record<string, Record<string, number>>,
    suppressed_video_ids: asObject(data.suppressedVideoIds ?? data.suppressed_video_ids) as Record<string, number>,
    suppressed_channels: asObject(data.suppressedChannels ?? data.suppressed_channels) as Record<string, number>,
    rejection_patterns: rejectionPatterns,
    feed_history: feedHistory,
    recent_query_tokens: recentQueryTokens,
    topic_evidence: topicEvidence,
  };
}
