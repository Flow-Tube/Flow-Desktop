import { describe, expect, it } from "vitest";

import type { LocalMediaFile } from "../../lib/api/localMedia";
import { localFileDetails } from "./LocalFileDetailsDialog";

const file: LocalMediaFile = {
  id: "local_0123456789abcdef",
  path: "/m/film.mkv",
  folderPath: "/m",
  kind: "video",
  title: "Film",
  fileName: "film.mkv",
  artist: "",
  album: "",
  durationMs: 90_000,
  sizeBytes: 1024,
  addedMs: 0,
  modifiedMs: 0,
  width: 1920,
  height: 1080,
  frameRate: 23.976,
  bitrateKbps: null,
  videoCodec: "h264",
  audioCodec: "aac",
};

describe("localFileDetails", () => {
  it("lists what the file has and leaves out what it doesn't", () => {
    const rows = Object.fromEntries(localFileDetails(file).map((row) => [row.label, row.value]));
    expect(rows["Resolution"]).toBe("1920 × 1080");
    expect(rows["Frame rate"]).toBe("23.98 fps");
    expect(rows["Video codec"]).toBe("h264");
    expect(rows).not.toHaveProperty("Artist");
    expect(rows).not.toHaveProperty("Bitrate");
    expect(rows).not.toHaveProperty("Added");
  });

  it("shows a song's tags, with no picture rows", () => {
    const rows = Object.fromEntries(
      localFileDetails({ ...file, kind: "audio", artist: "A band", width: 0, height: 0, frameRate: null, videoCodec: "" }).map(
        (row) => [row.label, row.value],
      ),
    );
    expect(rows["Artist"]).toBe("A band");
    expect(rows).not.toHaveProperty("Resolution");
    expect(rows).not.toHaveProperty("Frame rate");
    expect(rows).not.toHaveProperty("Video codec");
  });
});
