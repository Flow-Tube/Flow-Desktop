import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings = new Map<string, string>();
vi.mock("./api/db", () => ({
  getSetting: async (key: string) => settings.get(key) ?? null,
  setSetting: async (key: string, value: string) => void settings.set(key, value),
}));
const getPlaylistDetails = vi.fn();
vi.mock("./api/youtube", () => ({
  getPlaylistDetails: (id: string, token?: string | null) => getPlaylistDetails(id, token),
  getVideoMetadata: vi.fn(),
}));
vi.mock("./playlistMetadataChecks", () => ({
  recentlyCheckedIds: async () => new Set<string>(),
  rememberChecks: async () => undefined,
}));

import { usePlaylistDetails } from "./usePlaylistDetails";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const video = (id: string) => ({ id, title: id, channelName: "chan", thumbnailUrl: "t", publishedText: "1 day ago", viewCountText: "1 view", durationSeconds: 10 });

type Details = ReturnType<typeof usePlaylistDetails>;
let latest: Details;
function Probe({ id }: { id: string }) {
  latest = usePlaylistDetails(id);
  return null;
}

describe("usePlaylistDetails", () => {
  let root: Root;

  beforeEach(() => {
    settings.clear();
    getPlaylistDetails.mockReset();
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  const mount = async (id: string) => {
    await act(async () => root.render(createElement(Probe, { id })));
  };

  it("notes hidden videos once every page is in and the count is still higher", async () => {
    getPlaylistDetails.mockResolvedValueOnce({ title: "PL", channelName: "c", videos: [video("a")], videoCount: 3, nextPageToken: "T2" });
    await mount("PLone");
    expect(latest.hidesUnavailable).toBe(false);

    getPlaylistDetails.mockResolvedValueOnce({ videos: [video("b")], nextPageToken: null });
    await act(async () => void (await latest.loadMore()));
    expect(latest.videos).toHaveLength(2);
    expect(latest.hidesUnavailable).toBe(true);
  });

  it("does not note hidden videos when the count matches", async () => {
    getPlaylistDetails.mockResolvedValueOnce({ title: "PL", channelName: "c", videos: [video("a")], videoCount: 1, nextPageToken: null });
    await mount("PLtwo");
    expect(latest.hidesUnavailable).toBe(false);
  });

  it("never notes hidden videos for a playlist kept in the library", async () => {
    settings.set("user_playlists", JSON.stringify([{ id: "PLsaved", name: "Saved", source: "Saved", tracks: [video("a")], videoCount: 9 }]));
    getPlaylistDetails.mockResolvedValueOnce({ title: "PL", channelName: "c", videos: [video("a")], videoCount: 9, nextPageToken: null });
    await mount("PLsaved");
    expect(latest.hidesUnavailable).toBe(false);
  });

  const remotePlaylist = async () => {
    getPlaylistDetails.mockResolvedValueOnce({
      id: "PLremote", title: "List", channelName: "Owner", videos: [video("a")], videoCount: 3, nextPageToken: "T2",
    });
    await mount("PLremote");
  };

  it("waits for a page already being read before reading the rest", async () => {
    await remotePlaylist();
    let finishPage!: (page: unknown) => void;
    getPlaylistDetails.mockImplementationOnce(() => new Promise((resolve) => { finishPage = resolve; }));
    getPlaylistDetails.mockResolvedValueOnce({ videos: [video("c")], nextPageToken: null });

    let all: { id: string }[] = [];
    await act(async () => {
      void latest.loadMore();
      const walking = latest.loadAllVideos();
      finishPage({ videos: [video("b")], nextPageToken: "T3" });
      all = await walking;
    });

    expect(all.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(latest.videos.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(getPlaylistDetails.mock.calls.map((call) => call[1])).toEqual([undefined, "T2", "T3"]);
  });

  it("shares one walk between callers", async () => {
    await remotePlaylist();
    getPlaylistDetails.mockClear();
    getPlaylistDetails.mockResolvedValueOnce({ videos: [video("b")], nextPageToken: null });
    await act(async () => {
      const [one, two] = await Promise.all([latest.loadAllVideos(), latest.loadAllVideos()]);
      expect(two).toBe(one);
    });
    expect(getPlaylistDetails).toHaveBeenCalledTimes(1);
  });

  it("rejects when a page can't be read, keeping what was loaded", async () => {
    await remotePlaylist();
    getPlaylistDetails.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await expect(latest.loadAllVideos()).rejects.toThrow("offline");
    });
    expect(latest.videos.map((item) => item.id)).toEqual(["a"]);
    expect(latest.hasMore).toBe(true);
  });

  it("shows a rename without reading the playlist again", async () => {
    settings.set("user_playlists", JSON.stringify([{ id: "playlist-1", name: "Old", source: "Owned", tracks: [video("a")] }]));
    getPlaylistDetails.mockRejectedValue(new Error("not on YouTube"));
    await mount("playlist-1");
    const calls = getPlaylistDetails.mock.calls.length;

    act(() => latest.applyDetails({ id: "playlist-1", name: "New", description: "Notes", tracks: [video("a")] }));
    expect(latest.meta?.title).toBe("New");
    expect(latest.meta?.description).toBe("Notes");
    expect(getPlaylistDetails.mock.calls.length).toBe(calls);
  });
});
