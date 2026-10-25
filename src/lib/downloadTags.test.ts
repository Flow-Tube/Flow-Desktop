import { describe, expect, it } from "vitest";

import { trackDownloadTags, videoDownloadTags } from "./downloadTags";
import type { SongItem } from "../types/music";
import type { VideoSummary } from "../types/video";

const song: SongItem = {
  id: "s1",
  title: "Midnight City",
  artists: [{ name: "M83", id: "UC1" }, { name: " ", id: null }],
  album: { name: "Hurry Up, We're Dreaming", id: "MPREb_1" },
  duration: 243,
  musicVideoType: null,
  thumbnail: "",
  explicit: false,
  videoId: "v1",
  playlistId: null,
  params: null,
};

describe("download tags", () => {
  it("keeps credited artists, album and position", () => {
    expect(trackDownloadTags(song, { number: 2, total: 22 }, "M83", 2011)).toEqual({
      artists: ["M83"],
      channelId: "UC1",
      album: "Hurry Up, We're Dreaming",
      albumId: "MPREb_1",
      albumArtist: "M83",
      trackNumber: 2,
      trackTotal: 22,
      playlistId: undefined,
      releaseDate: "2011",
    });
  });

  it("leaves a single song's place and year to the backend", () => {
    const tags = trackDownloadTags(song);
    expect(tags.trackNumber).toBeUndefined();
    expect(tags.releaseDate).toBeUndefined();
  });

  it("passes what a video card knows", () => {
    const video = { id: "v", title: "T", channelName: "C", channelId: "UC9", viewCount: 12 } as VideoSummary;
    expect(videoDownloadTags(video)).toEqual({ channelName: "C", channelId: "UC9", viewCount: 12 });
  });
});
