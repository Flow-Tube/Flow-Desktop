// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { resolveHideWatched, useSubscriptionsHiddenFilter, useWatchedVideoIds } from "./useWatchedFilter";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { HISTORY_UPDATED_EVENT } from "../store/useHistoryStore";

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

describe("useWatchedVideoIds", () => {
  it("costs a card with its menu closed no extra render, and reads once opened", async () => {
    getWatchHistory.mockReset().mockResolvedValue([
      { videoId: "seen", watchDurationSeconds: 60, totalDurationSeconds: 60, isMusic: false },
    ]);
    let renders = 0;
    let ids = new Set<string>();
    function Probe({ open }: { open: boolean }) {
      renders += 1;
      ids = useWatchedVideoIds(open);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Probe, { open: false })));
    expect(renders).toBe(1);
    await act(async () => void window.dispatchEvent(new Event(HISTORY_UPDATED_EVENT)));
    expect(renders).toBe(1);
    expect(getWatchHistory).not.toHaveBeenCalled();

    await act(async () => root.render(createElement(Probe, { open: true })));
    expect(ids.has("seen")).toBe(true);
    await act(async () => void window.dispatchEvent(new Event(HISTORY_UPDATED_EVENT)));
    expect(getWatchHistory).toHaveBeenCalledTimes(2);

    await act(async () => root.render(createElement(Probe, { open: false })));
    expect(ids.size).toBe(0);
    await act(async () => root.unmount());
  });
});
