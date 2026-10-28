import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./streamResolution", () => ({ prefetchStreamInfo: vi.fn() }));

const { refreshForSettingKeys } = await import("./storeRefresh");
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
