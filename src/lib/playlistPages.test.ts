import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoSummary } from "../types/video";

const getPlaylistDetails = vi.fn();
vi.mock("./api/youtube", () => ({
  getPlaylistDetails: (id: string, token?: string | null) => getPlaylistDetails(id, token),
}));

import { PLAYLIST_PAGE_GUARD, appendUniqueVideos, loadRemainingPlaylistVideos } from "./playlistPages";

const video = (id: string): VideoSummary => ({ id, title: id, channelName: "", isLive: false });

describe("playlist pages", () => {
  beforeEach(() => getPlaylistDetails.mockReset());

  it("appends only videos it does not hold", () => {
    const merged = appendUniqueVideos([video("a"), video("b")], [video("b"), video("c")]);
    expect(merged.map((v) => v.id)).toEqual(["a", "b", "c"]);
  });

  it("follows tokens until a page has none", async () => {
    getPlaylistDetails
      .mockResolvedValueOnce({ title: "Unknown Playlist", videos: [video("b")], nextPageToken: "T3" })
      .mockResolvedValueOnce({ title: "Unknown Playlist", videos: [video("c")], nextPageToken: null });
    const all = await loadRemainingPlaylistVideos("PL1", [video("a")], "T2");
    expect(all.map((v) => v.id)).toEqual(["a", "b", "c"]);
    expect(getPlaylistDetails).toHaveBeenNthCalledWith(1, "PL1", "T2");
    expect(getPlaylistDetails).toHaveBeenNthCalledWith(2, "PL1", "T3");
  });

  it("stops at the page guard", async () => {
    getPlaylistDetails.mockImplementation(async () => ({ videos: [], nextPageToken: "again" }));
    await loadRemainingPlaylistVideos("PL1", [], "T2");
    expect(getPlaylistDetails).toHaveBeenCalledTimes(PLAYLIST_PAGE_GUARD - 1);
  });

  it("makes no request without a token", async () => {
    const all = await loadRemainingPlaylistVideos("PL1", [video("a")], null);
    expect(all).toHaveLength(1);
    expect(getPlaylistDetails).not.toHaveBeenCalled();
  });
});
