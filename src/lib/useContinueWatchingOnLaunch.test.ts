// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getWatchHistory = vi.fn();
vi.mock("./api/db", async (original) => ({
  ...(await original<object>()),
  getWatchHistory: (...args: unknown[]) => getWatchHistory(...args),
}));
vi.mock("./deepFlow", async (original) => ({ ...(await original<object>()), isDeepFlowCurrentlyActive: () => false }));

const { useContinueWatchingOnLaunch } = await import("./useContinueWatchingOnLaunch");
const { useAppSettingsStore } = await import("../store/useAppSettingsStore");
const { useMusicPlayerStore } = await import("../store/useMusicPlayerStore");
const { usePlayerStore } = await import("../store/usePlayerStore");
const { SETTINGS } = await import("./settings/schema");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const record = (videoId: string, extra: object = {}) => ({
  videoId,
  title: videoId,
  channelName: "c",
  channelId: null,
  watchDate: "2026-01-01T00:00:00Z",
  watchDurationSeconds: 100,
  totalDurationSeconds: 600,
  isMusic: false,
  ...extra,
});

let hook: ReturnType<typeof useContinueWatchingOnLaunch>;
let root: Root;
function Probe() {
  hook = useContinueWatchingOnLaunch();
  return null;
}
const render = () => act(async () => root.render(createElement(Probe)));

beforeEach(() => {
  window.localStorage.clear();
  getWatchHistory.mockReset();
  usePlayerStore.setState({ currentVideo: null });
  useMusicPlayerStore.setState({ currentTrack: null });
  useAppSettingsStore.setState((s) => ({
    loaded: true,
    values: { ...s.values, [SETTINGS.MINI_PLAYER_CONTINUE_WATCHING_ENABLED]: "true" },
  }));
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(async () => root.unmount()));

describe("useContinueWatchingOnLaunch", () => {
  it("offers the last unfinished video, skipping songs and finished ones", async () => {
    getWatchHistory.mockResolvedValue([
      record("song", { isMusic: true }),
      record("done", { watchDurationSeconds: 590 }),
      record("half"),
    ]);
    await render();
    expect(hook.video?.id).toBe("half");
  });

  it("stays away with the setting off", async () => {
    useAppSettingsStore.setState((s) => ({
      values: { ...s.values, [SETTINGS.MINI_PLAYER_CONTINUE_WATCHING_ENABLED]: "false" },
    }));
    await render();
    expect(getWatchHistory).not.toHaveBeenCalled();
  });

  it("gives way when a video or song is playing", async () => {
    getWatchHistory.mockResolvedValue([record("half")]);
    await render();
    expect(hook.video?.id).toBe("half");
    await act(async () => usePlayerStore.setState({ currentVideo: { id: "x", title: "x", channelName: "c" } }));
    expect(hook.video).toBeNull();
  });

  it("does not come back when the player closes", async () => {
    getWatchHistory.mockResolvedValue([record("half")]);
    await render();
    await act(async () => usePlayerStore.setState({ currentVideo: { id: "x", title: "x", channelName: "c" } }));
    await act(async () => usePlayerStore.setState({ currentVideo: null }));
    expect(hook.video).toBeNull();
  });

  it("ignores a history answer that arrives after something has played", async () => {
    let answer!: (history: unknown[]) => void;
    getWatchHistory.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    await render();
    await act(async () => useMusicPlayerStore.setState({ currentTrack: { id: "s" } as never }));
    await act(async () => useMusicPlayerStore.setState({ currentTrack: null }));
    await act(async () => answer([record("half")]));
    expect(hook.video).toBeNull();
  });

  it("does not offer a dismissed video again", async () => {
    getWatchHistory.mockResolvedValue([record("half")]);
    await render();
    await act(async () => hook.dismiss());
    expect(hook.video).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(document.createElement("div"));
    await render();
    expect(hook.video).toBeNull();
  });

  it("shows nothing when history can't be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getWatchHistory.mockRejectedValue(new Error("db"));
    await render();
    expect(hook.video).toBeNull();
    warn.mockRestore();
  });
});
