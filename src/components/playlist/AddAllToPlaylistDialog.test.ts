import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createPlaylistWithVideos = vi.fn();
vi.mock("../../lib/addVideosToPlaylist", () => ({
  addVideosToPlaylistWithToast: vi.fn(),
  createPlaylistWithVideos: (...args: unknown[]) => createPlaylistWithVideos(...args),
}));
vi.mock("../../lib/playlistLibrary", () => ({ loadStoredPlaylists: async () => [] }));

import { getString } from "../../lib/i18n/index";
import { AddAllToPlaylistDialog } from "./AddAllToPlaylistDialog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AddAllToPlaylistDialog", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    createPlaylistWithVideos.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("makes one playlist however many times Create is pressed", async () => {
    let finish!: (made: boolean) => void;
    createPlaylistWithVideos.mockReturnValue(new Promise<boolean>((resolve) => { finish = resolve; }));
    const loadVideos = async () => [];
    await act(async () => root.render(createElement(AddAllToPlaylistDialog, { loadVideos, onClose: () => undefined })));

    const open = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes(getString("playlist_add_modal_create")))!;
    await act(async () => open.click());
    const name = host.querySelector<HTMLInputElement>("#playlist-form-name")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "New");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = host.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(createPlaylistWithVideos).toHaveBeenCalledTimes(1);
    await act(async () => finish(false));
  });
});
