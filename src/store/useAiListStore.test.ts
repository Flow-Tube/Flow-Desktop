import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getAiListMatcherData: vi.fn(),
  getAiListStatus: vi.fn(),
  learnAiChannelHandles: vi.fn(async () => undefined),
  onAiListUpdated: vi.fn(async () => () => {}),
  refreshAiListNow: vi.fn(),
}));
vi.mock("../lib/api/aiList", () => api);
vi.mock("../lib/api/db", () => ({
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => undefined),
  addWatchRecord: vi.fn(async () => undefined),
}));

import { SETTINGS } from "../lib/settings/schema";
import { withoutHidden, type CombinedSearchResults } from "../lib/searchResults";
import { visibleFetchedShorts } from "../lib/useShortsFeed";
import type { ShortItem } from "../types/shorts";
import type { VideoSummary } from "../types/video";
import { getAiListMatcher, loadAiList, useAiListStore } from "./useAiListStore";
import { useAppSettingsStore } from "./useAppSettingsStore";
import { hiddenAsAi } from "./useFeedActionsStore";
import { useSubscriptionStore, type SubscribedChannel } from "./useSubscriptionStore";

const LISTED_ID = "UCbbbbbbbbbbbbbbbbbbbbbb";
const LEARNED_ID = "UCllllllllllllllllllllll";
const CLEAN_ID = "UCoooooooooooooooooooooo";

function setValues(values: Partial<Record<string, string>>) {
  useAppSettingsStore.setState((state) => ({ values: { ...state.values, ...values } }));
}

async function turnOn(block: boolean, warn: boolean, allowed = "[]") {
  setValues({
    [SETTINGS.AI_LIST_BLOCK_ENABLED]: String(block),
    [SETTINGS.AI_LIST_WARN_ENABLED]: String(warn),
    [SETTINGS.AI_LIST_ALLOWED]: allowed,
  });
  await loadAiList();
}

function video(id: string, channelId: string, extra: Partial<VideoSummary> = {}): VideoSummary {
  return { id, title: id, channelName: "c", channelId, ...extra };
}

beforeEach(() => {
  api.getAiListMatcherData.mockResolvedValue({
    version: 4,
    block: { handles: ["slopmaker"], ids: [LISTED_ID] },
    warn: { handles: ["maybeslop"], ids: [] },
    index: [[LEARNED_ID, "slopmaker"]],
  });
  api.getAiListStatus.mockResolvedValue({ channelCount: 3, updatedAtMs: 1, version: 4 });
  useSubscriptionStore.setState({ subscriptions: [] });
});

describe("the AI channel list store", () => {
  it("flags nothing and asks for nothing while both switches are off", async () => {
    api.getAiListMatcherData.mockClear();
    await turnOn(false, false);
    expect(api.getAiListMatcherData).not.toHaveBeenCalled();
    expect(getAiListMatcher().isActive).toBe(false);
    expect(useAiListStore.getState().status).toBeNull();
  });

  it("hides listed channels, including one known only through the saved handle index", async () => {
    await turnOn(true, false);
    const matcher = getAiListMatcher();
    expect(matcher.verdict(LISTED_ID)).toBe("block");
    expect(matcher.verdict(LEARNED_ID)).toBe("block");
    expect(matcher.verdict(CLEAN_ID)).toBe("none");
    expect(useAiListStore.getState().status?.channelCount).toBe(3);
  });

  it("exempts allowed and subscribed channels", async () => {
    await turnOn(true, true, JSON.stringify([{ id: LISTED_ID, name: "Listed" }]));
    expect(getAiListMatcher().verdict(LISTED_ID)).toBe("none");

    useSubscriptionStore.setState({ subscriptions: [{ id: LEARNED_ID, name: "Sub" } as SubscribedChannel] });
    await turnOn(true, true);
    expect(getAiListMatcher().verdict(LEARNED_ID)).toBe("none");
  });

  it("keeps the last list when the backend cannot be read", async () => {
    await turnOn(true, false);
    api.getAiListMatcherData.mockRejectedValueOnce(new Error("offline"));
    await loadAiList();
    expect(getAiListMatcher().verdict(LISTED_ID)).toBe("block");
  });
});

describe("the hide paths", () => {
  it("hide a collaboration by its lead channel's handle", async () => {
    await turnOn(true, false);
    const collab = video("v", "UCcccccccccccccccccccccc", {
      collaborators: [{ channelId: "UCcccccccccccccccccccccc", name: "Lead", handle: "@SlopMaker" }],
    });
    expect(hiddenAsAi(getAiListMatcher(), collab)).toBe(true);
    expect(hiddenAsAi(getAiListMatcher(), video("w", CLEAN_ID))).toBe(false);
  });

  it("hide a card by the handle its byline links to, and then its channel by id alone", async () => {
    await turnOn(true, false);
    const channelId = "UCeeeeeeeeeeeeeeeeeeeeee";
    expect(hiddenAsAi(getAiListMatcher(), video("v", channelId))).toBe(false);
    expect(hiddenAsAi(getAiListMatcher(), video("v", channelId, { channelHandle: "/@SlopMaker" }))).toBe(true);
    expect(hiddenAsAi(getAiListMatcher(), video("w", channelId))).toBe(true);
    // Learned pairs reach the backend in one batch a moment later.
    await vi.waitFor(
      () =>
        expect(api.learnAiChannelHandles).toHaveBeenCalledWith(
          expect.arrayContaining([{ channelId, handle: "slopmaker" }]),
        ),
      { timeout: 3000 },
    );
  });

  it("label rather than hide in label-only mode", async () => {
    await turnOn(false, true);
    expect(hiddenAsAi(getAiListMatcher(), video("v", LISTED_ID))).toBe(false);
    expect(getAiListMatcher().verdict(LISTED_ID)).toBe("warn");
  });

  it("drop listed channels and their videos from search results", async () => {
    await turnOn(true, false);
    const matcher = getAiListMatcher();
    const results = {
      topResult: { kind: "channel", item: { channelId: CLEAN_ID, name: "x", handle: "@MaybeSlop", isVerified: false } },
      videos: [video("a", LISTED_ID), video("b", CLEAN_ID)],
      live: [],
      shorts: [],
      channels: [{ channelId: "UCdddddddddddddddddddddd", name: "s", handle: "@SlopMaker", isVerified: false }],
      shelves: [],
    } as unknown as CombinedSearchResults;
    const visible = withoutHidden(results, {
      videoIds: new Set(),
      channelIds: new Set(),
      hidesAsAi: (channelId, handle) => matcher.verdict(channelId, handle) === "block",
    });
    expect(visible.videos.map((item) => item.id)).toEqual(["b"]);
    expect(visible.channels).toEqual([]);
    expect(visible.topResult).not.toBeNull();
  });

  it("leave listed channels out of the Shorts feed", async () => {
    await turnOn(true, false);
    const shorts = [{ id: "s1", channelId: LISTED_ID }, { id: "s2", channelId: CLEAN_ID }] as unknown as ShortItem[];
    expect(visibleFetchedShorts(shorts).map((item) => item.id)).toEqual(["s2"]);
  });
});
