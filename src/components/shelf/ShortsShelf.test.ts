// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ShortsShelf } from "./ShortsShelf";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { SETTINGS } from "../../lib/settings/schema";

vi.mock("../shorts/ShortCard", () => ({
  ShortCard: ({ short }: { short: { id: string } }) => createElement("article", null, short.id),
}));
const getWatchHistory = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api/db", async (original) => ({ ...(await original<object>()), getWatchHistory }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ShortsShelf", () => {
  it("shows the Shorts it is given, finished or not", async () => {
    getWatchHistory.mockResolvedValue([
      { videoId: "done", watchDurationSeconds: 60, totalDurationSeconds: 60, isMusic: false },
    ]);
    useAppSettingsStore.setState((s) => ({ values: { ...s.values, [SETTINGS.HIDE_WATCHED_SHORTS]: "true" } }));
    const host = document.createElement("div");
    const root = createRoot(host);
    const shorts = [{ type: "short", id: "done", title: "done", channelName: "c" }] as never;
    await act(async () => root.render(createElement(ShortsShelf, { title: "Shorts", shorts, onPlay: () => {} })));
    expect(host.querySelectorAll("article")).toHaveLength(1);
    await act(async () => root.unmount());
  });
});
