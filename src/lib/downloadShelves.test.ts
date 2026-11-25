import { describe, expect, it } from "vitest";
import { downloadShelves } from "./downloadShelves";
import type { DownloadRecord } from "./api/downloads";

const record = (id: number, mediaKind: DownloadRecord["mediaKind"], collectionDbId: number | null = null) =>
  ({
    id,
    videoId: `v${id}`,
    title: `Title ${id}`,
    author: "Channel",
    mediaKind,
    collectionDbId,
    thumbnailUrl: null,
    coverUrl: null,
    durationSeconds: 60,
    artistsJson: null,
    album: null,
    albumId: null,
    channelId: null,
  }) as DownloadRecord;

describe("downloadShelves", () => {
  it("splits single downloads into videos and songs, leaving collections to the Downloads page", () => {
    const shelves = downloadShelves([record(1, "video"), record(2, "audio"), record(3, "video", 7)]);
    expect(shelves.videos.map((video) => video.id)).toEqual(["v1"]);
    expect(shelves.songs.map((song) => song.id)).toEqual(["v2"]);
  });

  it("previews at most the limit on each shelf", () => {
    const shelves = downloadShelves([record(1, "video"), record(2, "video"), record(3, "video")], 2);
    expect(shelves.videos).toHaveLength(2);
  });
});
