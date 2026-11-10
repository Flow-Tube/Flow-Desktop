import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const confirmAction = vi.fn();
vi.mock("../../lib/dialogs", () => ({ confirmAction: (request: unknown) => confirmAction(request) }));
const downloadManyWithToast = vi.fn();
vi.mock("../../lib/downloadMany", () => ({ downloadManyWithToast: (targets: unknown) => downloadManyWithToast(targets) }));
const removeVideosFromStoredPlaylist = vi.fn();
const restoreStoredPlaylistTracks = vi.fn();
const getStoredPlaylistById = vi.fn();
vi.mock("../../lib/playlistLibrary", async (actual) => ({
  ...(await actual<typeof import("../../lib/playlistLibrary")>()),
  getStoredPlaylistById: (id: string) => getStoredPlaylistById(id),
  removeVideosFromStoredPlaylist: (id: string, ids: unknown) => removeVideosFromStoredPlaylist(id, ids),
  restoreStoredPlaylistTracks: (id: string, removed: unknown) => restoreStoredPlaylistTracks(id, removed),
}));

import { useUiStore } from "../../store/useUiStore";
import { PlaylistSelectionActions } from "./PlaylistSelectionActions";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const video = { id: "a", title: "a", channelName: "c" };

describe("PlaylistSelectionActions", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onDone = vi.fn();
  const onTracksChanged = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    useUiStore.setState({ toast: null });
    getStoredPlaylistById.mockResolvedValue({ tracks: [] });
    removeVideosFromStoredPlaylist.mockResolvedValue([{ track: video, afterId: null }]);
    restoreStoredPlaylistTracks.mockResolvedValue(null);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = (editable: boolean) =>
    act(() => {
      root.render(createElement(PlaylistSelectionActions, {
        playlistId: "p",
        editable,
        selected: [video],
        allSelected: true,
        onToggleAll: vi.fn(),
        onDone,
        onTracksChanged,
      }));
    });

  const button = (label: string) =>
    [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === label);

  it("offers Remove only on a playlist you can change", () => {
    render(false);
    expect(button("Remove")).toBeUndefined();
    expect(button("Download")).toBeDefined();
    render(true);
    expect(button("Remove")).toBeDefined();
  });

  it("removes after asking, then Undo puts them back", async () => {
    render(true);
    confirmAction.mockResolvedValue(true);
    await act(async () => button("Remove")!.click());
    expect(removeVideosFromStoredPlaylist).toHaveBeenCalledTimes(1);
    expect(onTracksChanged).toHaveBeenCalledWith([]);
    expect(onDone).toHaveBeenCalled();

    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe("Removed 1 video");
    await act(async () => toast?.actions[0]?.onSelect?.());
    expect(restoreStoredPlaylistTracks).toHaveBeenCalledWith("p", [{ track: video, afterId: null }]);
  });

  it("does nothing when you decline", async () => {
    render(true);
    confirmAction.mockResolvedValue(false);
    await act(async () => button("Remove")!.click());
    expect(removeVideosFromStoredPlaylist).not.toHaveBeenCalled();
  });

  it("downloads the selected videos", () => {
    render(false);
    act(() => button("Download")!.click());
    expect(downloadManyWithToast).toHaveBeenCalledWith([{ kind: "video", video }]);
  });
});
