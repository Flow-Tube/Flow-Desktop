import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { confirmPlaylistRemoval } from "../../lib/confirmPlaylistRemoval";
import { isOwnedPlaylist, removePlaylistFromLibrary } from "../../lib/playlistLibrary";
import { showSaveToast } from "../../lib/saveToast";
import { PlaylistCard } from "./PlaylistCard";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../lib/confirmPlaylistRemoval", () => ({ confirmPlaylistRemoval: vi.fn() }));
vi.mock("../../lib/playlistLibrary", async (actual) => ({
  ...(await actual<typeof import("../../lib/playlistLibrary")>()),
  isOwnedPlaylist: vi.fn(),
  isPlaylistInLibrary: vi.fn(async () => true),
  removePlaylistFromLibrary: vi.fn(async () => []),
}));
vi.mock("../../lib/saveToast", () => ({ showSaveToast: vi.fn(), showSaveFailedToast: vi.fn() }));

const playlist = { type: "playlist" as const, id: "playlist-1", title: "Road trip" };

describe("PlaylistCard removing from the library", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(PlaylistCard, { playlist, isInLibrary: true })));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const chooseRemove = async () => {
    await act(async () => {
      host.firstElementChild!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 5 }));
    });
    const item = [...document.querySelectorAll<HTMLElement>("button,[role='menuitem']")]
      .find((element) => /saved|remove from library/i.test(`${element.textContent} ${element.getAttribute("aria-label") ?? ""}`))!;
    await act(async () => {
      item.click();
    });
  };

  it("deletes your own playlist after asking, with no Undo", async () => {
    vi.mocked(isOwnedPlaylist).mockResolvedValue(true);
    vi.mocked(confirmPlaylistRemoval).mockResolvedValue(true);

    await chooseRemove();

    expect(confirmPlaylistRemoval).toHaveBeenCalledWith(playlist, true);
    expect(removePlaylistFromLibrary).toHaveBeenCalledWith("playlist-1");
    expect(vi.mocked(showSaveToast).mock.calls[0]?.[0].undo).toBeUndefined();
  });

  it("keeps Undo for a saved playlist", async () => {
    vi.mocked(isOwnedPlaylist).mockResolvedValue(false);
    vi.mocked(confirmPlaylistRemoval).mockResolvedValue(true);

    await chooseRemove();

    expect(confirmPlaylistRemoval).toHaveBeenCalledWith(playlist, false);
    expect(vi.mocked(showSaveToast).mock.calls[0]?.[0].undo).toBeTypeOf("function");
  });

  it("keeps the playlist when the question is declined", async () => {
    vi.mocked(isOwnedPlaylist).mockResolvedValue(true);
    vi.mocked(confirmPlaylistRemoval).mockResolvedValue(false);

    await chooseRemove();

    expect(removePlaylistFromLibrary).not.toHaveBeenCalled();
    expect(showSaveToast).not.toHaveBeenCalled();
  });
});
