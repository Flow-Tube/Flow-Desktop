import { describe, expect, it } from "vitest";

import type { DownloadRecord } from "./api/downloads";
import {
  downloadRecordToSong,
  downloadRecordToVideo,
  downloadRecordToVideoDetails,
  downloadSponsorSegments,
} from "./useDownloads";

const record: DownloadRecord = {
  id: 7,
  videoId: "abc",
  title: "Midnight City",
  author: "M83",
  mediaKind: "music",
  filePath: "/music/M83 - Midnight City.m4a",
  thumbnailUrl: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
  durationSeconds: 243,
  qualityLabel: "AAC",
  fileSizeBytes: 1,
  collectionDbId: null,
  createdAt: "",
  coverUrl: "http://127.0.0.1:5555/stream/download-cover-7",
  artistsJson: '["M83","Zola Jesus"]',
  album: "Hurry Up, We're Dreaming",
  albumId: "MPREb_1",
  releaseDate: "2011",
  description: "Song",
  channelId: "UC1",
  container: "m4a",
  videoCodec: null,
  chaptersJson: '[{"title":"Intro","startSeconds":0,"endSeconds":30}]',
  sponsorblockJson: '[{"category":"sponsor","segment":[1,2],"UUID":"u"}]',
};

describe("download records", () => {
  it("prefer the stored cover so artwork works offline", () => {
    expect(downloadRecordToVideo(record).thumbnailUrl).toBe(record.coverUrl);
    expect(downloadRecordToSong({ ...record, coverUrl: null }).thumbnail).toBe(record.thumbnailUrl);
  });

  it("keep every credited artist and the album", () => {
    const song = downloadRecordToSong(record);
    expect(song.artists.map((artist) => artist.name)).toEqual(["M83", "Zola Jesus"]);
    expect(song.album).toEqual({ name: "Hurry Up, We're Dreaming", id: "MPREb_1" });
  });

  it("give the watch page its chapters and segments without the network", () => {
    expect(downloadRecordToVideoDetails(record).chapters).toEqual([
      { title: "Intro", startSeconds: 0, endSeconds: 30 },
    ]);
    expect(downloadSponsorSegments(record)).toHaveLength(1);
    expect(downloadRecordToVideoDetails({ ...record, chaptersJson: "not json" }).chapters).toEqual([]);
  });
});
