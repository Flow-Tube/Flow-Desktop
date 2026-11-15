import type { AiListEntries, AiVerdict } from "../api/aiList";
import { normalizeAiHandle } from "./handle";

const CHANNEL_ID_LENGTH = 24;
const INDEX_CAPACITY = 50_000;

function isChannelId(id: string): boolean {
  return id.length === CHANNEL_ID_LENGTH && id.startsWith("UC");
}

function cleanId(channelId: string | null | undefined): string {
  return (channelId ?? "").replace(/^channel:/, "").trim();
}

/** One list side as lookup sets. */
export interface AiListSets {
  handles: ReadonlySet<string>;
  ids: ReadonlySet<string>;
}

export interface AiLists {
  block: AiListSets;
  warn: AiListSets;
  /** The AI music artist list: channel ids only, and no warn tier, so it can only hide. */
  music: AiListSets;
}

const toSets = (entries: AiListEntries | null | undefined): AiListSets => ({
  handles: new Set(entries?.handles ?? []),
  ids: new Set(entries?.ids ?? []),
});

export function toAiLists(block: AiListEntries, warn: AiListEntries, music?: AiListEntries | null): AiLists {
  return { block: toSets(block), warn: toSets(warn), music: toSets(music) };
}

/** What the viewer switched on and chose to see anyway. */
export interface AiListRules {
  blockEnabled: boolean;
  warnEnabled: boolean;
  /** Hide music by artists on the AI music list. */
  musicEnabled: boolean;
  /** Subscribed and allowed channel ids. */
  exemptIds: ReadonlySet<string>;
  /** Allowed channels' normalized handles. */
  exemptHandles: ReadonlySet<string>;
}

/**
 * Channel id to normalized handle, learned from everything that carries both. The list holds
 * handles while most cards carry only a channel id, so this is how a Home card still matches a
 * listed handle. The least recently used pairs go first past the capacity.
 */
export class AiHandleIndex {
  private readonly entries = new Map<string, string>();

  constructor(
    pairs: Iterable<readonly [string, string]> = [],
    private readonly onLearn: (channelId: string, handle: string) => void = () => {},
    private readonly capacity = INDEX_CAPACITY,
  ) {
    for (const [id, handle] of pairs) this.put(id, handle);
  }

  handleFor(channelId: string): string | undefined {
    const handle = this.entries.get(channelId);
    if (handle !== undefined) {
      this.entries.delete(channelId);
      this.entries.set(channelId, handle);
    }
    return handle;
  }

  /** Records a pair; reports it to `onLearn` when it is new or changed. */
  learn(channelId: string, normalizedHandle: string): void {
    if (this.entries.get(channelId) === normalizedHandle) return;
    this.put(channelId, normalizedHandle);
    this.onLearn(channelId, normalizedHandle);
  }

  private put(channelId: string, handle: string): void {
    this.entries.delete(channelId);
    this.entries.set(channelId, handle);
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }
}

export interface AiListMatcher {
  /** A channel switch is on and a list is held, so a video lookup can flag something. */
  readonly isActive: boolean;
  /** A music lookup can flag something: AiSList ids or the AI music artist list. */
  readonly isMusicActive: boolean;
  /** A video's channel. Video surfaces never use the AI music list. */
  verdict(channelId: string | null | undefined, handle?: string | null): AiVerdict;
  /**
   * A music item by the channel ids it credits: a song's artists, an album's artists, a playlist's
   * author, an artist's own channel. One listed, non-exempt id is enough, so a collaboration with a
   * listed artist is flagged too.
   */
  musicVerdict(ids: ReadonlyArray<string | null | undefined>): AiVerdict;
  /** True when the AI music list, rather than AiSList, is why an artist is flagged. */
  isOnMusicList(channelId: string | null | undefined): boolean;
  /** Records a pair seen outside a card, such as a channel search result or a channel page. */
  learn(channelId: string | null | undefined, handle: string | null | undefined): void;
}

export const AI_LIST_MATCHER_NONE: AiListMatcher = {
  isActive: false,
  isMusicActive: false,
  verdict: () => "none",
  musicVerdict: () => "none",
  isOnMusicList: () => false,
  learn: () => {},
};

function isEmpty(sets: AiListSets): boolean {
  return sets.handles.size === 0 && sets.ids.size === 0;
}

/**
 * The answer for every card. A subscribed or allowed channel is never flagged. With hiding off, a
 * block-list channel is still labelled when labels are on: it is the more certain of the two lists.
 * Music also checks the AI music artist list. Same rules as Flow for Android's `AiListMatcher`.
 */
export function createAiListMatcher(
  lists: AiLists | null,
  rules: AiListRules,
  index: AiHandleIndex | null,
): AiListMatcher {
  const isActive =
    !!lists && (rules.blockEnabled || rules.warnEnabled) && !(isEmpty(lists.block) && isEmpty(lists.warn));
  const musicIds = lists && rules.musicEnabled ? lists.music.ids : new Set<string>();
  const isMusicActive = isActive || musicIds.size > 0;
  if (!lists || !isMusicActive) return AI_LIST_MATCHER_NONE;

  const verdict = (rawChannelId: string | null | undefined, handle?: string | null): AiVerdict => {
    if (!isActive) return "none";
    const channelId = cleanId(rawChannelId);
    if (channelId && rules.exemptIds.has(channelId)) return "none";
    const id = isChannelId(channelId) ? channelId : null;
    const named = handle?.trim() ? handle : channelId.startsWith("@") ? channelId : null;
    const normalized = named ? normalizeAiHandle(named) : null;
    if (id && normalized) index?.learn(id, normalized);
    const key = normalized ?? (id ? index?.handleFor(id) : undefined);
    if (key && rules.exemptHandles.has(key)) return "none";
    const on = (sets: AiListSets) => (!!key && sets.handles.has(key)) || (!!id && sets.ids.has(id));
    const onBlock = on(lists.block);
    if (onBlock && rules.blockEnabled) return "block";
    return (onBlock || on(lists.warn)) && rules.warnEnabled ? "warn" : "none";
  };

  return {
    isActive,
    isMusicActive,
    verdict,
    musicVerdict(ids) {
      let result: AiVerdict = "none";
      for (const raw of ids) {
        const id = cleanId(raw);
        if (!isChannelId(id) || rules.exemptIds.has(id)) continue;
        if (musicIds.has(id)) return "block";
        const listed = verdict(id, null);
        if (listed === "block") return "block";
        if (listed === "warn") result = "warn";
      }
      return result;
    },
    isOnMusicList(rawChannelId) {
      const id = cleanId(rawChannelId);
      return musicIds.has(id) && !rules.exemptIds.has(id);
    },
    learn(rawChannelId, handle) {
      if (!isActive) return;
      const channelId = cleanId(rawChannelId);
      if (!isChannelId(channelId)) return;
      const normalized = normalizeAiHandle(handle);
      if (normalized) index?.learn(channelId, normalized);
    },
  };
}
