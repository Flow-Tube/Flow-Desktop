import { create } from "zustand";
import { getSetting, setSetting } from "../lib/api/db";

export interface SubscribedChannel {
  id: string;
  name: string;
  avatarUrl?: string;
  subscriberCountText?: string;
  /** Epoch ms. Doubles as this record's sync clock, so a subscribe/unsubscribe race resolves by
   *  when each actually happened (FLOW-SYNC/1 §10.0). */
  subscribedAt?: number;
  isMusic?: boolean;
}

/** The subscription fields a metadata refresh may overwrite. */
type SubscriptionTextField = "name" | "avatarUrl" | "subscriberCountText";

export interface SubscriptionGroup {
  name: string;
  channelIds: string[];
  sortOrder: number;
}

interface SubscriptionState {
  subscriptions: SubscribedChannel[];
  subscriptionGroups: SubscriptionGroup[];
  loading: boolean;
  loadSubscriptions: () => Promise<void>;
  subscribe: (channelId: string, channelName: string, avatarUrl?: string) => Promise<void>;
  unsubscribe: (channelId: string) => Promise<void>;
  updateSubscription: (channelId: string, updates: Partial<Omit<SubscribedChannel, "id">>) => Promise<void>;
  mergeSubscriptions: (updates: Record<string, Partial<Omit<SubscribedChannel, "id">>>) => Promise<void>;
  loadSubscriptionGroups: () => Promise<void>;
  createSubscriptionGroup: (name: string, channelIds: string[]) => Promise<void>;
  updateSubscriptionGroup: (oldName: string, name: string, channelIds: string[]) => Promise<void>;
  deleteSubscriptionGroup: (name: string) => Promise<void>;
  moveSubscriptionGroup: (name: string, direction: -1 | 1) => Promise<void>;
  isSubscribed: (channelId: string) => boolean;
}

const SUBSCRIPTIONS_KEY = "subscriptions";
const SUBSCRIPTION_GROUPS_KEY = "subscription_groups";
/** Unsubscribes we still remember, `{channelId: epochMs}` — see `recordUnsubscribe`. */
const SUBSCRIPTION_TOMBSTONES_KEY = "subscription_tombstones";
const TOMBSTONE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

const LEGACY_SEED_IDS = new Set(["UCsBjURrdU234nU351gVEfTA", "UCwRxwjk_c_92sAMeX4JzW4w"]);

function cleanChannelId(channelId: string) {
  return channelId.replace("channel:", "");
}

function cleanGroup(group: SubscriptionGroup, sortOrder: number): SubscriptionGroup {
  return {
    name: group.name.trim(),
    channelIds: Array.from(new Set(group.channelIds.map(cleanChannelId).filter(Boolean))),
    sortOrder,
  };
}

async function readTombstones(): Promise<Record<string, number>> {
  try {
    const raw = await getSetting(SUBSCRIPTION_TOMBSTONES_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Drop tombstones past the TTL so the store can't grow without bound. */
function pruneTombstones(tombstones: Record<string, number>, now: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(tombstones).filter(([, at]) => typeof at === "number" && now - at <= TOMBSTONE_TTL_MS),
  );
}

/**
 * Remember an unsubscribe. A channel that is simply absent is indistinguishable from one this
 * device never followed, so without a tombstone the next sync would put it straight back.
 */
async function recordUnsubscribe(channelId: string) {
  const now = Date.now();
  const next = pruneTombstones(await readTombstones(), now);
  next[channelId] = now;
  await setSetting(SUBSCRIPTION_TOMBSTONES_KEY, JSON.stringify(next));
}

/** Re-subscribing clears the tombstone, otherwise the peer would keep removing the channel. */
async function clearTombstone(channelId: string) {
  const tombstones = await readTombstones();
  if (!(channelId in tombstones)) return;
  delete tombstones[channelId];
  await setSetting(SUBSCRIPTION_TOMBSTONES_KEY, JSON.stringify(pruneTombstones(tombstones, Date.now())));
}

async function persistSubscriptions(subscriptions: SubscribedChannel[]) {
  await setSetting(SUBSCRIPTIONS_KEY, JSON.stringify(subscriptions));
}

async function persistGroups(groups: SubscriptionGroup[]) {
  const ordered = groups
    .filter((group) => group.name.trim())
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(cleanGroup);
  await setSetting(SUBSCRIPTION_GROUPS_KEY, JSON.stringify(ordered));
}

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  subscriptions: [],
  subscriptionGroups: [],
  loading: false,

  loadSubscriptions: async () => {
    set({ loading: true });
    try {
      const subsJson = await getSetting(SUBSCRIPTIONS_KEY);
      const parsed: SubscribedChannel[] = subsJson ? JSON.parse(subsJson) : [];
      const cleaned = parsed.filter((channel) => !LEGACY_SEED_IDS.has(channel.id));
      // Channels saved before sync existed carry no timestamp, which would read as "epoch" and lose
      // to any tombstone the peer still holds — silently unsubscribing the user. Stamping them now
      // is the honest answer (this is when we first knew) and errs toward keeping the subscription.
      const now = Date.now();
      const backfilled = cleaned.map((channel) =>
        channel.subscribedAt ? channel : { ...channel, subscribedAt: now },
      );
      const changed = cleaned.length !== parsed.length || backfilled.some((c, i) => c !== cleaned[i]);
      if (changed) {
        await persistSubscriptions(backfilled);
      }
      set({ subscriptions: backfilled, loading: false });
    } catch (e) {
      console.error("Failed to load subscriptions in store", e);
      set({ loading: false });
    }
  },

  subscribe: async (channelId, channelName, avatarUrl) => {
    const { subscriptions } = get();
    const cleanId = cleanChannelId(channelId);
    const existing = subscriptions.find((c) => c.id === cleanId);
    await clearTombstone(cleanId);
    if (existing) {
      if (avatarUrl && !existing.avatarUrl) {
        await get().updateSubscription(cleanId, { avatarUrl });
      }
      return;
    }
    const updated = [
      ...subscriptions,
      { id: cleanId, name: channelName, avatarUrl, subscribedAt: Date.now() },
    ];
    set({ subscriptions: updated });
    await persistSubscriptions(updated);
  },

  unsubscribe: async (channelId) => {
    const { subscriptions, subscriptionGroups } = get();
    const cleanId = cleanChannelId(channelId);
    const updated = subscriptions.filter((c) => c.id !== cleanId);
    const updatedGroups = subscriptionGroups.map((group, index) =>
      cleanGroup(
        {
          ...group,
          channelIds: group.channelIds.filter((id) => id !== cleanId),
        },
        index,
      ),
    );
    set({ subscriptions: updated });
    await persistSubscriptions(updated);
    await recordUnsubscribe(cleanId);
    set({ subscriptionGroups: updatedGroups });
    await persistGroups(updatedGroups);
  },

  updateSubscription: async (channelId, updates) => {
    const cleanId = cleanChannelId(channelId);
    const updated = get().subscriptions.map((channel) => (
      channel.id === cleanId
        ? { ...channel, ...updates, id: cleanId }
        : channel
    ));
    set({ subscriptions: updated });
    await persistSubscriptions(updated);
  },

  mergeSubscriptions: async (updates) => {
    if (Object.keys(updates).length === 0) return;

    let changed = false;
    const next = get().subscriptions.map((channel) => {
      const patch = updates[channel.id];
      if (!patch) return channel;

      let merged = channel;
      // Only the display-text fields are patchable here; `subscribedAt`/`isMusic` are set by
      // subscribe/unsubscribe and by the sync merge, never by a metadata refresh.
      for (const [key, value] of Object.entries(patch) as [SubscriptionTextField, string | undefined][]) {
        if (value !== undefined && merged[key] !== value) {
          if (merged === channel) merged = { ...channel };
          merged[key] = value;
          changed = true;
        }
      }
      return merged;
    });

    if (!changed) return;
    set({ subscriptions: next });
    await persistSubscriptions(next);
  },

  loadSubscriptionGroups: async () => {
    try {
      const groupsJson = await getSetting(SUBSCRIPTION_GROUPS_KEY);
      const parsed = groupsJson ? JSON.parse(groupsJson) as SubscriptionGroup[] : [];
      const groups = parsed
        .map((group, index) => cleanGroup(group, group.sortOrder ?? index))
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((group, index) => ({ ...group, sortOrder: index }));
      set({ subscriptionGroups: groups });
    } catch (e) {
      console.error("Failed to load subscription groups", e);
      set({ subscriptionGroups: [] });
    }
  },

  createSubscriptionGroup: async (name, channelIds) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const groups = get().subscriptionGroups;
    const withoutDuplicate = groups.filter((group) => group.name !== trimmedName);
    const updated = [
      ...withoutDuplicate,
      cleanGroup({ name: trimmedName, channelIds, sortOrder: withoutDuplicate.length }, withoutDuplicate.length),
    ];
    set({ subscriptionGroups: updated });
    await persistGroups(updated);
  },

  updateSubscriptionGroup: async (oldName, name, channelIds) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const groups = get().subscriptionGroups;
    const existingIndex = groups.findIndex((group) => group.name === oldName);
    const nextGroups = groups
      .filter((group) => group.name !== trimmedName || group.name === oldName)
      .map((group, index) => (
        group.name === oldName
          ? cleanGroup({ name: trimmedName, channelIds, sortOrder: group.sortOrder }, index)
          : cleanGroup(group, index)
      ));

    const updated = existingIndex >= 0
      ? nextGroups
      : [...nextGroups, cleanGroup({ name: trimmedName, channelIds, sortOrder: nextGroups.length }, nextGroups.length)];

    set({ subscriptionGroups: updated });
    await persistGroups(updated);
  },

  deleteSubscriptionGroup: async (name) => {
    const updated = get().subscriptionGroups
      .filter((group) => group.name !== name)
      .map((group, index) => cleanGroup(group, index));
    set({ subscriptionGroups: updated });
    await persistGroups(updated);
  },

  moveSubscriptionGroup: async (name, direction) => {
    const groups = [...get().subscriptionGroups].sort((a, b) => a.sortOrder - b.sortOrder);
    const currentIndex = groups.findIndex((group) => group.name === name);
    const targetIndex = Math.max(0, Math.min(groups.length - 1, currentIndex + direction));
    if (currentIndex < 0 || currentIndex === targetIndex) return;

    const [moved] = groups.splice(currentIndex, 1);
    if (!moved) return;
    groups.splice(targetIndex, 0, moved);
    const updated = groups.map((group, index) => cleanGroup(group, index));
    set({ subscriptionGroups: updated });
    await persistGroups(updated);
  },

  isSubscribed: (channelId) => {
    const cleanId = cleanChannelId(channelId);
    return get().subscriptions.some((c) => c.id === cleanId);
  },
}));
