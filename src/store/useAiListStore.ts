import { create } from "zustand";
import {
  getAiListMatcherData,
  getAiListStatus,
  learnAiChannelHandles,
  onAiListUpdated,
  refreshAiListNow,
  type AiChannelRef,
  type AiListOutcome,
  type AiListStatus,
} from "../lib/api/aiList";
import { normalizeAiHandle } from "../lib/aiList/handle";
import {
  AI_LIST_MATCHER_NONE,
  AiHandleIndex,
  createAiListMatcher,
  toAiLists,
  type AiListMatcher,
  type AiLists,
} from "../lib/aiList/matcher";
import { SETTINGS } from "../lib/settings/schema";
import { useAppSettingsStore } from "./useAppSettingsStore";
import { useSubscriptionStore } from "./useSubscriptionStore";

/** A channel the viewer chose to see despite the list; the name lets Settings show it offline. */
export interface AllowedAiChannel {
  id: string;
  name: string;
  handle?: string | null;
}

/** Learned handles go to the backend in batches; it keeps them for the next start. */
const LEARN_FLUSH_MS = 2000;

interface AiListState {
  /** The list as lookup sets; null while the filter is off or before one was downloaded. */
  lists: AiLists | null;
  status: AiListStatus | null;
  refreshing: boolean;
  /** Rebuilt whenever the list, a switch, the allow list or the subscriptions change. */
  matcher: AiListMatcher;
}

export const useAiListStore = create<AiListState>(() => ({
  lists: null,
  status: null,
  refreshing: false,
  matcher: AI_LIST_MATCHER_NONE,
}));

let index = new AiHandleIndex();
let pendingLearned: AiChannelRef[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let loadRequest = 0;

function flushLearned() {
  flushTimer = null;
  const batch = pendingLearned;
  pendingLearned = [];
  learnAiChannelHandles(batch).catch((error) => console.warn("Failed to save learned channel handles", error));
}

function rememberLearned(channelId: string, handle: string) {
  pendingLearned.push({ channelId, handle });
  flushTimer ??= setTimeout(flushLearned, LEARN_FLUSH_MS);
}

export function parseAllowedAiChannels(raw: string | undefined): AllowedAiChannel[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is AllowedAiChannel =>
        !!entry && typeof entry === "object" && typeof (entry as AllowedAiChannel).id === "string",
    );
  } catch {
    return [];
  }
}

export function readAiListSwitches(values = useAppSettingsStore.getState().values) {
  return {
    blockEnabled: values[SETTINGS.AI_LIST_BLOCK_ENABLED] === "true",
    warnEnabled: values[SETTINGS.AI_LIST_WARN_ENABLED] === "true",
    musicEnabled: values[SETTINGS.AI_MUSIC_BLOCK_ENABLED] === "true",
  };
}

/** Any list switched on: AI channels hidden or labelled, or AI music hidden. */
export function anyAiListOn(values = useAppSettingsStore.getState().values): boolean {
  const { blockEnabled, warnEnabled, musicEnabled } = readAiListSwitches(values);
  return blockEnabled || warnEnabled || musicEnabled;
}

const isOn = () => anyAiListOn();

function rebuildMatcher() {
  const values = useAppSettingsStore.getState().values;
  const { blockEnabled, warnEnabled, musicEnabled } = readAiListSwitches(values);
  const allowed = parseAllowedAiChannels(values[SETTINGS.AI_LIST_ALLOWED]);
  const subscribed = useSubscriptionStore.getState().subscriptions.map((channel) => channel.id);
  const matcher = createAiListMatcher(
    useAiListStore.getState().lists,
    {
      blockEnabled,
      warnEnabled,
      musicEnabled,
      exemptIds: new Set([...subscribed, ...allowed.map((channel) => channel.id)]),
      exemptHandles: new Set(
        allowed.map((channel) => normalizeAiHandle(channel.handle)).filter((handle): handle is string => !!handle),
      ),
    },
    index,
  );
  useAiListStore.setState({ matcher });
}

/** Reads the list from the backend, or drops it while the filter is off. */
export async function loadAiList(): Promise<void> {
  const request = ++loadRequest;
  if (!isOn()) {
    useAiListStore.setState({ lists: null, status: null });
    rebuildMatcher();
    return;
  }
  try {
    const [data, status] = await Promise.all([getAiListMatcherData(), getAiListStatus()]);
    if (request !== loadRequest) return;
    index = new AiHandleIndex(data?.index ?? [], rememberLearned);
    useAiListStore.setState({ lists: data ? toAiLists(data.block, data.warn, data.music) : null, status });
  } catch (error) {
    // The filter is optional: without a list nothing is flagged and feeds stay as they are.
    console.warn("Failed to load the AI lists", error);
    if (request !== loadRequest) return;
  }
  rebuildMatcher();
}

/** Downloads the list now; a new list is read back when the backend announces it. */
export async function refreshAiList(): Promise<AiListOutcome | null> {
  if (!isOn()) return null;
  useAiListStore.setState({ refreshing: true });
  try {
    const result = await refreshAiListNow();
    if (result.status) useAiListStore.setState({ status: result.status });
    return result.outcome;
  } catch (error) {
    console.warn("Failed to refresh the AI lists", error);
    return "retry";
  } finally {
    useAiListStore.setState({ refreshing: false });
  }
}

/** Starts following the switches, the allow list, subscriptions and new lists. Safe to call often. */
export function startAiList(): void {
  if (started) return;
  started = true;
  let previous = useAppSettingsStore.getState().values;
  useAppSettingsStore.subscribe((state) => {
    const values = state.values;
    const switched =
      values[SETTINGS.AI_LIST_BLOCK_ENABLED] !== previous[SETTINGS.AI_LIST_BLOCK_ENABLED] ||
      values[SETTINGS.AI_LIST_WARN_ENABLED] !== previous[SETTINGS.AI_LIST_WARN_ENABLED] ||
      values[SETTINGS.AI_MUSIC_BLOCK_ENABLED] !== previous[SETTINGS.AI_MUSIC_BLOCK_ENABLED];
    const sourceChanged =
      values[SETTINGS.AI_LIST_SOURCE_URL] !== previous[SETTINGS.AI_LIST_SOURCE_URL] ||
      values[SETTINGS.AI_LIST_SOURCE_KEY] !== previous[SETTINGS.AI_LIST_SOURCE_KEY];
    const allowedChanged = values[SETTINGS.AI_LIST_ALLOWED] !== previous[SETTINGS.AI_LIST_ALLOWED];
    previous = values;
    if (switched || sourceChanged) void loadAiList();
    else if (allowedChanged) rebuildMatcher();
  });
  useSubscriptionStore.subscribe((state, before) => {
    if (state.subscriptions !== before.subscriptions) rebuildMatcher();
  });
  onAiListUpdated(() => void loadAiList()).catch((error) =>
    console.warn("Failed to follow AI channel list updates", error),
  );
  void loadAiList();
}

/** The current matcher, for code outside a render such as the Shorts feed. */
export function getAiListMatcher(): AiListMatcher {
  return useAiListStore.getState().matcher;
}
