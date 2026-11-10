// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const loadStoredPlaylists = vi.fn();
vi.mock("./playlistLibrary", () => ({
  PLAYLIST_LIBRARY_UPDATED_EVENT: "updated",
  loadStoredPlaylists: () => loadStoredPlaylists(),
}));
const { useVideoSaved } = await import("./useVideoSaved");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useVideoSaved", () => {
  it("follows the library", async () => {
    let saved = false;
    function Probe() {
      saved = useVideoSaved("v");
      return null;
    }
    loadStoredPlaylists.mockResolvedValue([{ tracks: [{ id: "other" }] }]);
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Probe)));
    expect(saved).toBe(false);

    loadStoredPlaylists.mockResolvedValue([{ tracks: [{ id: "v" }] }]);
    await act(async () => void window.dispatchEvent(new Event("updated")));
    expect(saved).toBe(true);
    await act(async () => root.unmount());
  });
});
