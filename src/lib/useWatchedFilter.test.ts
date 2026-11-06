// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { resolveHideWatched, useSubscriptionsHiddenFilter } from "./useWatchedFilter";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";

const getWatchHistory = vi.hoisted(() => vi.fn());
vi.mock("./api/db", async (original) => ({ ...(await original<object>()), getWatchHistory }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("resolveHideWatched", () => {
  it("follows the synced switch until the surface has its own choice", () => {
    expect(resolveHideWatched("", "true")).toBe(true);
    expect(resolveHideWatched("", "false")).toBe(false);
    expect(resolveHideWatched(undefined, "true")).toBe(true);
  });

  it("lets the surface's choice win either way", () => {
    expect(resolveHideWatched("false", "true")).toBe(false);
    expect(resolveHideWatched("true", "false")).toBe(true);
  });
});

describe("useSubscriptionsHiddenFilter", () => {
  it("hides a watched video but leaves a watched Short to its own setting", async () => {
    const watched = (videoId: string) => ({
      videoId,
      watchDurationSeconds: 60,
      totalDurationSeconds: 60,
      isMusic: false,
    });
    getWatchHistory.mockResolvedValue([watched("video"), watched("short")]);
    useAppSettingsStore.setState((s) => ({ values: { ...s.values, [SETTINGS.HIDE_WATCHED_SUBSCRIPTIONS]: "true" } }));
    let isHidden!: ReturnType<typeof useSubscriptionsHiddenFilter>;
    function Probe() {
      isHidden = useSubscriptionsHiddenFilter();
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Probe)));
    expect(isHidden({ id: "video", title: "", channelName: "" })).toBe(true);
    expect(isHidden({ id: "short", title: "", channelName: "", isShort: true })).toBe(false);
    await act(async () => root.unmount());
  });
});
