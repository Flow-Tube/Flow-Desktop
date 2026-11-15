import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoSummary } from "../types/video";

const getPlaylistDetails = vi.fn();
const getMixPlaylist = vi.fn();
vi.mock("./api/youtube", () => ({
  getPlaylistDetails: (id: string, token?: string | null) => getPlaylistDetails(id, token),
  getMixPlaylist: (id: string, videoId?: string | null) => getMixPlaylist(id, videoId),
}));

import {
  PLAYLIST_PAGE_GUARD,
  appendUniqueVideos,
  firstPlaylistPage,
  loadRemainingPlaylistVideos,
  walkRemainingPlaylistPages,
} from "./playlistPages";

const video = (id: string): VideoSummary => ({ id, title: id, channelName: "", isLive: false });

describe("first playlist page", () => {
  beforeEach(() => {
    getPlaylistDetails.mockReset();
    getMixPlaylist.mockReset();
  });

  it("reads a Mix from its watch queue, around the video it was opened from", async () => {
    await firstPlaylistPage("RDdQw4w9WgXcQ", "aaaaaaaaaaa");
    await firstPlaylistPage("RDMMdQw4w9WgXcQ");
    expect(getMixPlaylist).toHaveBeenNthCalledWith(1, "RDdQw4w9WgXcQ", "aaaaaaaaaaa");
    expect(getMixPlaylist).toHaveBeenNthCalledWith(2, "RDMMdQw4w9WgXcQ", undefined);
    expect(getPlaylistDetails).not.toHaveBeenCalled();
  });

  it("browses every other playlist, album radios included", async () => {
    await firstPlaylistPage("PLabcdefghij", "aaaaaaaaaaa");
    await firstPlaylistPage("RDCLAK5uy_abcdef");
    expect(getPlaylistDetails).toHaveBeenNthCalledWith(1, "PLabcdefghij", undefined);
    expect(getPlaylistDetails).toHaveBeenNthCalledWith(2, "RDCLAK5uy_abcdef", undefined);
    expect(getMixPlaylist).not.toHaveBeenCalled();
  });
});

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

  it("says whether the walk reached the end", async () => {
    getPlaylistDetails.mockImplementation(async () => ({ videos: [], nextPageToken: "again" }));
    expect((await walkRemainingPlaylistPages("PL1", [], "T2")).finished).toBe(false);
    getPlaylistDetails.mockImplementation(async () => ({ videos: [], nextPageToken: null }));
    expect((await walkRemainingPlaylistPages("PL1", [], "T2")).finished).toBe(true);
  });

  it("makes no request without a token", async () => {
    const all = await loadRemainingPlaylistVideos("PL1", [video("a")], null);
    expect(all).toHaveLength(1);
    expect(getPlaylistDetails).not.toHaveBeenCalled();
  });
});
