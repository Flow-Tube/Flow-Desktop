import { describe, expect, it, vi } from "vitest";

const { loadNotes, loaded } = vi.hoisted(() => ({
  loadNotes: vi.fn(async () => {}),
  loaded: () => ({ getState: () => new Proxy({}, { get: () => async () => {} }), setState: () => {} }),
}));

vi.mock("../playlistLibrary", () => ({ PLAYLIST_LIBRARY_UPDATED_EVENT: "playlists" }));
vi.mock("../../store/useAlbumLibraryStore", () => ({ useAlbumLibraryStore: loaded() }));
vi.mock("../../store/useAppSettingsStore", () => ({ useAppSettingsStore: loaded() }));
vi.mock("../../store/useHistoryStore", () => ({ useHistoryStore: loaded() }));
vi.mock("../../store/useLikesStore", () => ({ LIKES_LIBRARY_UPDATED_EVENT: "likes", useLikesStore: loaded() }));
vi.mock("../../store/useSubscriptionStore", () => ({ useSubscriptionStore: loaded() }));
vi.mock("../../store/useNotesStore", () => ({ useNotesStore: { getState: () => ({ load: loadNotes }) } }));

import { refreshAfterRestore } from "./refreshAfterRestore";

describe("refreshing after a restore", () => {
  it("reloads the notes, which the store otherwise reads only at launch", async () => {
    await refreshAfterRestore();
    expect(loadNotes).toHaveBeenCalledTimes(1);
  });
});
