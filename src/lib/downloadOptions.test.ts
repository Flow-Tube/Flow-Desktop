import { describe, expect, it } from "vitest";

import type { DownloadableFormat } from "./api/downloads";
import {
  audioSizeEstimate,
  autoCodec,
  defaultRow,
  formatBytes,
  formatTimeLeft,
  preferredCodec,
  qualityRows,
  resolutionBadge,
} from "./downloadOptions";

function format(id: string, height: number, codec: string, fps = 30): DownloadableFormat {
  return {
    formatId: id,
    resolution: `${height}p`,
    width: null,
    height,
    fps,
    container: "mp4",
    videoCodec: codec,
    audioCodec: "AAC",
    videoMimeType: "",
    audioMimeType: "",
    videoBitrate: null,
    audioBitrate: null,
    videoSizeBytes: null,
    audioSizeBytes: null,
    estimatedSizeBytes: null,
  };
}

const formats = [
  format("vp9-1080-60", 1080, "VP9", 60),
  format("h264-1080", 1080, "H.264"),
  format("av1-1080", 1080, "AV1"),
  format("vp9-720", 720, "VP9"),
  format("h264-480", 480, "H.264"),
];

describe("download options", () => {
  it("keeps H.264 for Auto on a Mac, which cannot play VP9 in MP4", () => {
    expect(autoCodec(true)).toBe("H.264");
    expect(autoCodec(false)).toBe("VP9");
    expect(preferredCodec({ download_video_codec: "AV1" }, true)).toBe("AV1");
    expect(preferredCodec({ download_video_codec: "Auto" }, true)).toBe("H.264");
  });

  it("shows one row per height, preferred codec first, others filling gaps", () => {
    const rows = qualityRows(formats, "Auto", "H.264");
    expect(rows.map((row) => row.formatId)).toEqual(["h264-1080", "vp9-720", "h264-480"]);
    expect(qualityRows(formats, "VP9", "H.264").map((row) => row.formatId)).toEqual(["vp9-1080-60", "vp9-720"]);
  });

  it("defaults to the tallest row at or below the preferred height", () => {
    const rows = qualityRows(formats, "Auto", "VP9");
    expect(defaultRow(rows, 900)?.formatId).toBe("vp9-720");
    expect(defaultRow(rows, 240)?.formatId).toBe("h264-480");
    expect(defaultRow([], 1080)).toBeNull();
  });

  it("formats sizes, badges and estimates", () => {
    expect(resolutionBadge(2160)).toBe("4K");
    expect(resolutionBadge(1080)).toBe("HD");
    expect(resolutionBadge(720)).toBeNull();
    expect(formatBytes(1.9 * 1024 ** 3)).toBe("1.9 GB");
    expect(formatBytes(482 * 1024 ** 2)).toBe("482 MB");
    expect(formatBytes(null)).toBeNull();
    expect(audioSizeEstimate(243, 128)).toBe(3_888_000);
    expect(formatTimeLeft(46)).toBe("46 s");
    expect(formatTimeLeft(150)).toBe("3 min");
  });
});
