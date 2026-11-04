import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./streamResolution", () => ({ prefetchStreamInfo: vi.fn() }));

const { BRAINS_UPDATED_EVENT, refreshForSettingKeys, refreshSyncedCollections } = await import("./storeRefresh");
const { HISTORY_UPDATED_EVENT, useHistoryStore } = await import("../store/useHistoryStore");
const { useLikesStore } = await import("../store/useLikesStore");
const { useAppSettingsStore } = await import("../store/useAppSettingsStore");
const { useSettingsStore } = await import("../store/useSettingsStore");
const { useSubscriptionStore } = await import("../store/useSubscriptionStore");
const { useFeedActionsStore } = await import("../store/useFeedActionsStore");

afterEach(() => vi.restoreAllMocks());

describe("refreshForSettingKeys", () => {
  it("reloads only the stores whose stored values changed", async () => {
    const likes = vi.fn(async () => {});
    const subscriptions = vi.fn(async () => {});
    const appSettings = vi.fn(async () => {});
    const playerSettings = vi.fn(async () => {});
    const feedActions = vi.fn(async () => {});
    useLikesStore.setState({ load: likes, loaded: true });
    useSubscriptionStore.setState({ loadSubscriptions: subscriptions });
    useAppSettingsStore.setState({ loadSettings: appSettings });
    useSettingsStore.setState({ loadSettings: playerSettings });
    useFeedActionsStore.setState({ load: feedActions, loaded: true });
    const libraryEvent = vi.fn();
    window.addEventListener("flow:likes-library-updated", libraryEvent);

    await refreshForSettingKeys(["liked_items", "subscriptions", "feed_actions_state_v1"]);
    expect(likes).toHaveBeenCalledTimes(1);
    expect(useLikesStore.getState().loaded).toBe(false);
    expect(libraryEvent).toHaveBeenCalledTimes(1);
    expect(subscriptions).toHaveBeenCalledTimes(1);
    expect(feedActions).toHaveBeenCalledTimes(1);
    expect(appSettings).not.toHaveBeenCalled();

    await refreshForSettingKeys(["theme_id", "auto_pip_enabled", "not_a_known_key"]);
    expect(appSettings).toHaveBeenCalledTimes(1);
    expect(playerSettings).toHaveBeenCalledTimes(1);
    window.removeEventListener("flow:likes-library-updated", libraryEvent);
  });
});

describe("refreshSyncedCollections", () => {
  it("reloads both settings stores after a settings merge", async () => {
    const appSettings = vi.fn(async () => {});
    const playerSettings = vi.fn(async () => {});
    useAppSettingsStore.setState({ loadSettings: appSettings });
    useSettingsStore.setState({ loadSettings: playerSettings });

    await refreshSyncedCollections(["settings"]);
    expect(appSettings).toHaveBeenCalledTimes(1);
    expect(playerSettings).toHaveBeenCalledTimes(1);
  });

  it("reloads loaded history and tells the history readers and brain views", async () => {
    const history = vi.fn(async () => {});
    useHistoryStore.setState({ load: history, loaded: true });
    const historyEvent = vi.fn();
    const brainsEvent = vi.fn();
    window.addEventListener(HISTORY_UPDATED_EVENT, historyEvent);
    window.addEventListener(BRAINS_UPDATED_EVENT, brainsEvent);

    await refreshSyncedCollections(["watch_history", "flow_neuro_brain", "music_brain"]);
    expect(history).toHaveBeenCalledWith(true);
    expect(historyEvent).toHaveBeenCalledTimes(1);
    expect(brainsEvent).toHaveBeenCalledTimes(1);

    useHistoryStore.setState({ loaded: false });
    await refreshSyncedCollections(["watch_history"]);
    expect(history).toHaveBeenCalledTimes(1);
    expect(historyEvent).toHaveBeenCalledTimes(2);
    window.removeEventListener(HISTORY_UPDATED_EVENT, historyEvent);
    window.removeEventListener(BRAINS_UPDATED_EVENT, brainsEvent);
  });
});
