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
}

export function toAiLists(block: AiListEntries, warn: AiListEntries): AiLists {
  return {
    block: { handles: new Set(block.handles), ids: new Set(block.ids) },
    warn: { handles: new Set(warn.handles), ids: new Set(warn.ids) },
  };
}

/** What the viewer switched on and chose to see anyway. */
export interface AiListRules {
  blockEnabled: boolean;
  warnEnabled: boolean;
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
  /** A switch is on and a list is held, so a lookup can flag something. */
  readonly isActive: boolean;
  verdict(channelId: string | null | undefined, handle?: string | null): AiVerdict;
  /** Records a pair seen outside a card, such as a channel search result or a channel page. */
  learn(channelId: string | null | undefined, handle: string | null | undefined): void;
}

export const AI_LIST_MATCHER_NONE: AiListMatcher = {
  isActive: false,
  verdict: () => "none",
  learn: () => {},
};

function isEmpty(sets: AiListSets): boolean {
  return sets.handles.size === 0 && sets.ids.size === 0;
}

/**
 * The answer for every card. A subscribed or allowed channel is never flagged. With hiding off, a
 * block-list channel is still labelled when labels are on: it is the more certain of the two lists.
 * Same rule as `src-tauri/src/ai_list/matcher.rs` and Flow for Android.
 */
export function createAiListMatcher(
  lists: AiLists | null,
  rules: AiListRules,
  index: AiHandleIndex | null,
): AiListMatcher {
  if (!lists || !(rules.blockEnabled || rules.warnEnabled) || (isEmpty(lists.block) && isEmpty(lists.warn))) {
    return AI_LIST_MATCHER_NONE;
  }
  return {
    isActive: true,
    verdict(rawChannelId, handle) {
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
    },
    learn(rawChannelId, handle) {
      const channelId = cleanId(rawChannelId);
      if (!isChannelId(channelId)) return;
      const normalized = normalizeAiHandle(handle);
      if (normalized) index?.learn(channelId, normalized);
    },
  };
}
