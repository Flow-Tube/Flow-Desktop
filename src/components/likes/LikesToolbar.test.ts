import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const confirmAction = vi.fn();
vi.mock("../../lib/dialogs", () => ({ confirmAction: (request: unknown) => confirmAction(request) }));
const downloadManyWithToast = vi.fn();
vi.mock("../../lib/downloadMany", () => ({ downloadManyWithToast: (targets: unknown) => downloadManyWithToast(targets) }));
const savePlaylistFileWithToast = vi.fn();
vi.mock("../../lib/playlistTransfer", () => ({ savePlaylistFileWithToast: (file: unknown) => savePlaylistFileWithToast(file) }));
const removeMany = vi.fn();
const restore = vi.fn();
vi.mock("../../store/useLikesStore", () => ({
  useLikesStore: (selector: (state: unknown) => unknown) => selector({ removeMany, restore }),
}));
const setQueue = vi.fn();
vi.mock("../../store/usePlayerStore", () => {
  const state = { setQueue: (...args: unknown[]) => setQueue(...args), addToQueue: () => "added" };
  return { usePlayerStore: Object.assign((selector: (s: unknown) => unknown) => selector(state), { getState: () => state }) };
});
const playQueue = vi.fn();
vi.mock("../../store/useMusicPlayerStore", () => ({
  useMusicPlayerStore: (selector: (s: unknown) => unknown) => selector({ playQueue: (...args: unknown[]) => playQueue(...args), addToQueue: vi.fn() }),
}));

import { useUiStore } from "../../store/useUiStore";
import type { LikedItem } from "../../store/useLikesStore";
import type { SongItem } from "../../types/music";
import { LikesToolbar } from "./LikesToolbar";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const video: LikedItem = { kind: "video", id: "v", likedAt: "2026-01-01T00:00:00.000Z", video: { id: "v", title: "V", channelName: "c" } };
const song: LikedItem = { kind: "music", id: "s", likedAt: "2026-01-01T00:00:00.000Z", song: { id: "s", videoId: "s", title: "S", artists: [] } as unknown as SongItem };

describe("LikesToolbar", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onDoneSelecting = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    useUiStore.setState({ toast: null });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = (props: Partial<Parameters<typeof LikesToolbar>[0]>) =>
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(LikesToolbar, {
        items: [video, song],
        sortOrder: "date_added_newest",
        onSortChange: vi.fn(),
        selecting: false,
        selected: [],
        allSelected: false,
        onStartSelecting: vi.fn(),
        onToggleAll: vi.fn(),
        onDoneSelecting,
        ...props,
      })));
    });

  const byLabel = (label: string) => host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
  const byText = (label: string) => [...host.querySelectorAll("button")].find((button) => button.textContent === label)!;

  it("plays the videos when both are on show, never queueing songs in the video player", () => {
    render({});
    act(() => byText("Play").click());
    expect(setQueue.mock.calls[0]?.[0]).toEqual([video.kind === "video" && video.video]);
    expect(playQueue).not.toHaveBeenCalled();
  });

  it("plays a music-only view in the music player", () => {
    render({ items: [song] });
    act(() => byText("Play").click());
    expect(playQueue).toHaveBeenCalledTimes(1);
    expect(setQueue).not.toHaveBeenCalled();
  });

  it("asks before Download all, and takes both kinds", async () => {
    render({});
    confirmAction.mockResolvedValue(true);
    await act(async () => byLabel("Download all").click());
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(downloadManyWithToast.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it("saves what's on show as a file", () => {
    render({});
    act(() => byLabel("Save as file").click());
    expect(savePlaylistFileWithToast).toHaveBeenCalledTimes(1);
  });

  it("removes the selected likes, with Undo", async () => {
    render({ selecting: true, selected: [video] });
    confirmAction.mockResolvedValue(true);
    removeMany.mockResolvedValue([video]);
    restore.mockResolvedValue(undefined);
    await act(async () => byText("Remove").click());
    expect(onDoneSelecting).toHaveBeenCalled();
    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe("Removed 1 like");
    await act(async () => toast?.actions[0]?.onSelect?.());
    expect(restore).toHaveBeenCalledWith([video]);
  });

  it("reports a failed removal", async () => {
    render({ selecting: true, selected: [video] });
    confirmAction.mockResolvedValue(true);
    removeMany.mockRejectedValue(new Error("db"));
    await act(async () => byText("Remove").click());
    expect(useUiStore.getState().toast?.variant).toBe("error");
    expect(onDoneSelecting).not.toHaveBeenCalled();
  });
});
