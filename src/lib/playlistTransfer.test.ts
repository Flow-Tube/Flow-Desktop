import { beforeEach, describe, expect, it, vi } from "vitest";

const saveJsonFile = vi.fn();
vi.mock("./saveJsonFile", () => ({ saveJsonFile: (...args: unknown[]) => saveJsonFile(...args) }));
const settings = new Map<string, string>();
vi.mock("./api/db", () => ({
  getSetting: async (key: string) => settings.get(key) ?? null,
  setSetting: async (key: string, value: string) => void settings.set(key, value),
}));
vi.mock("./api/youtube", () => ({ getPlaylistDetails: vi.fn() }));

import { importPlaylistFileWithToast, savePlaylistFileWithToast, savePlaylistWhenLoaded } from "./playlistTransfer";
import { loadStoredPlaylists } from "./playlistLibrary";
import { useAlbumLibraryStore } from "../store/useAlbumLibraryStore";
import { useUiStore } from "../store/useUiStore";

const ID = "dQw4w9WgXcQ";
const file = (contents: unknown, name = "backup.json") =>
  new File([typeof contents === "string" ? contents : JSON.stringify(contents)], name);
const playlistFile = (playlist: object, videos: object[] = [{ id: ID, title: "T" }]) =>
  file({ format: "flow-playlist", version: 1, exportedAt: 1, playlist, videos });

const toast = () => useUiStore.getState().toast;

describe("importPlaylistFileWithToast", () => {
  beforeEach(() => {
    settings.clear();
    useUiStore.setState({ toast: null });
    useAlbumLibraryStore.setState({ albums: [], loaded: false });
  });

  it("adds a video playlist as your own", async () => {
    await importPlaylistFileWithToast(playlistFile({ name: " Road trip ", description: "Notes" }));
    const imported = (await loadStoredPlaylists()).find((playlist) => playlist.name === "Road trip");
    expect(imported?.source).toBe("Owned");
    expect(imported?.description).toBe("Notes");
    expect(imported?.tracks.map((track) => track.id)).toEqual([ID]);
    expect(toast()?.message).toBe("Imported Road trip, 1 video");
    expect(toast()?.actions[0]?.to).toBe(`/playlist/${imported?.id}`);
  });

  it("sends a music playlist to the Music library, not the video one", async () => {
    await importPlaylistFileWithToast(playlistFile({ name: "Mix", isMusic: true }));
    const album = useAlbumLibraryStore.getState().albums[0];
    expect(album?.source).toBe("Owned");
    expect(album?.tracks?.map((track) => track.videoId)).toEqual([ID]);
    expect((await loadStoredPlaylists()).some((playlist) => playlist.name === "Mix")).toBe(false);
    expect(toast()?.message).toBe("Imported Mix, 1 song");
  });

  it("names an unnamed playlist after its file", async () => {
    await importPlaylistFileWithToast(file({ format: "flow-playlist", version: 1, exportedAt: 1, playlist: { name: " " }, videos: [{ id: ID }] }, "summer.json"));
    expect((await loadStoredPlaylists()).some((playlist) => playlist.name === "summer")).toBe(true);
  });

  it.each([
    ["a wrong file", file("{}"), "This file isn't a Flow playlist"],
    ["a newer file", file({ format: "flow-playlist", version: 9, playlist: { name: "x" }, videos: [] }), "This playlist needs a newer version of Flow"],
    ["an empty one", playlistFile({ name: "x" }, []), "This playlist has no videos to import"],
  ])("explains %s", async (_label, input, message) => {
    await importPlaylistFileWithToast(input);
    expect(toast()?.variant).toBe("error");
    expect(toast()?.message).toBe(message);
  });
});

describe("savePlaylistFileWithToast", () => {
  const contents = { name: "Mine", description: "", isMusic: false, videos: [{ id: ID }] };

  beforeEach(() => {
    saveJsonFile.mockReset();
    useUiStore.setState({ toast: null });
  });

  it("offers the sanitized name and confirms", async () => {
    saveJsonFile.mockResolvedValue(true);
    await savePlaylistFileWithToast(contents);
    expect(saveJsonFile.mock.calls[0]?.[1]).toBe("Mine.json");
    expect(toast()?.message).toBe("Playlist saved");
  });

  it("stays quiet when the dialog is cancelled", async () => {
    saveJsonFile.mockResolvedValue(false);
    await savePlaylistFileWithToast(contents);
    expect(toast()).toBeNull();
  });

  it("saves nothing when the rest of the list can't be read", async () => {
    await savePlaylistWhenLoaded(() => Promise.reject(new Error("offline")));
    expect(saveJsonFile).not.toHaveBeenCalled();
    expect(toast()?.message).toBe("Couldn't save the playlist");
  });

  it("reports a failed write", async () => {
    saveJsonFile.mockRejectedValue(new Error("disk"));
    await savePlaylistFileWithToast(contents);
    expect(toast()?.message).toBe("Couldn't save the playlist");
  });
});
