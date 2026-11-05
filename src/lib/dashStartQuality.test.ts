import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  manifestVideoTracks,
  pickDashStart,
  readMeasuredSpeedKbps,
  recordVideoSegmentSpeed,
} from "./dashStartQuality";
import type { DashVideoTrack } from "./dashVideoTrack";
import type { StreamVariant } from "../types/video";

const track = (id: string, codec: string, rungs: Array<[string, number, number]>): DashVideoTrack => ({
  id,
  mimeType: "video/mp4",
  codec: `video/mp4;codecs="${codec}"`,
  bitrateList: rungs.map(([repId, height, bandwidth]) => ({ id: repId, height, bandwidth })),
});

const h264 = track("video-h264-mp4", "avc1.640028", [
  ["h360", 360, 450_000],
  ["h480", 480, 850_000],
  ["h1080", 1080, 3_500_000],
]);
const vp9 = track("video-vp9-mp4", "vp09.00.40.08", [
  ["v1080", 1080, 2_500_000],
  ["v2160", 2160, 12_000_000],
]);

const chosen = (id: string) => ({ id }) as StreamVariant;
const start = (id: string | null, speedKbps: number | null, tracks = [h264, vp9], preferredCodec = "H.264") =>
  pickDashStart({ selected: id ? chosen(id) : null, tracks, preferredCodec, speedKbps });

describe("pickDashStart with a chosen quality", () => {
  it("starts at the exact rung when no speed is known yet", () => {
    expect(start("h1080", null)).toEqual({ bitrateKbps: 3500, setId: "video-h264-mp4" });
  });

  it("starts in the rung's own set when it isn't the first one", () => {
    expect(start("v1080", null)).toEqual({ bitrateKbps: 2500, setId: "video-vp9-mp4" });
  });

  it("starts at the exact rung exactly at the 2.5 times line", () => {
    expect(start("h1080", 8750).bitrateKbps).toBe(3500);
  });

  it("keeps dash.js's low start just under the line, so a slow link starts soon", () => {
    expect(start("h1080", 8749)).toEqual({ bitrateKbps: null, setId: "video-h264-mp4" });
  });

  it("stays in the chosen codec on a slow start, so the video never hops codecs", () => {
    expect(start("v1080", 1000)).toEqual({ bitrateKbps: null, setId: "video-vp9-mp4" });
  });

  it("never holds a low choice to the higher default start", () => {
    expect(start("h360", 900)).toEqual({ bitrateKbps: 450, setId: "video-h264-mp4" });
  });

  it("rounds up, because dash.js takes the highest rung at or below the number", () => {
    const fractional = track("video-h264-mp4", "avc1.640028", [["x", 720, 1_800_001]]);
    expect(start("x", null, [fractional]).bitrateKbps).toBe(1801);
  });

  it("leaves it to the later switch when the rung isn't in the manifest", () => {
    expect(start("missing", null)).toEqual({ bitrateKbps: null, setId: null });
  });

  it("leaves it to the later switch when the rung has no bitrate", () => {
    const unknown = track("video-h264-mp4", "avc1.640028", [["x", 720, 0]]);
    expect(start("x", null, [unknown])).toEqual({ bitrateKbps: null, setId: null });
  });
});

describe("pickDashStart on Auto", () => {
  it("stays at dash.js's start until a speed is known, in the set it will climb", () => {
    expect(start(null, null)).toEqual({ bitrateKbps: null, setId: "video-vp9-mp4" });
  });

  it("starts where the first segment loads as quickly as a chosen quality's must", () => {
    expect(start(null, 20_000).bitrateKbps).toBe(8000);
  });

  it("takes the preferred codec when sets tie", () => {
    const av1 = track("video-av1-mp4", "av01.0.12M.08", [["a2160", 2160, 10_000_000]]);
    expect(start(null, null, [h264, vp9, av1], "AV1").setId).toBe("video-av1-mp4");
  });

  it("starts in what's left when a set can't be decoded here", () => {
    expect(start(null, null, [h264], "AV1").setId).toBe("video-h264-mp4");
  });

  it("names no set when the manifest offers none", () => {
    expect(start(null, null, [])).toEqual({ bitrateKbps: null, setId: null });
  });
});

describe("manifestVideoTracks", () => {
  const manifest = {
    Period: [{
      AdaptationSet: [
        { id: "audio-en", contentType: "audio", mimeType: "audio/mp4", Representation: [{ id: "a", bandwidth: 128_000 }] },
        {
          id: "video-vp9-webm",
          contentType: "video",
          mimeType: "video/webm",
          Representation: [{ id: 248, bandwidth: 2_500_000, width: 1920, height: 1080, codecs: "vp09.00.40.08" }],
        },
      ],
    }],
  };

  it("keeps only video sets, with string ids and the codec dash.js reports", () => {
    expect(manifestVideoTracks(manifest)).toEqual([{
      id: "video-vp9-webm",
      mimeType: "video/webm",
      codec: 'video/webm;codecs="vp09.00.40.08"',
      bitrateList: [{ id: "248", bandwidth: 2_500_000, width: 1920, height: 1080 }],
    }]);
  });

  it("gives nothing for a manifest it can't read", () => {
    expect(manifestVideoTracks(null)).toEqual([]);
    expect(manifestVideoTracks({})).toEqual([]);
    expect(manifestVideoTracks({ Period: [{}] })).toEqual([]);
  });
});

describe("measured speed", () => {
  const MB = 1024 * 1024;
  const segment = (bytesLoaded: number, elapsedMs: number, overrides: Record<string, unknown> = {}) => ({
    mediaType: "video",
    request: {
      type: "MediaSegment",
      bytesLoaded,
      startDate: new Date(1000),
      endDate: new Date(1000 + elapsedMs),
    },
    ...overrides,
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("has no reading on a fresh install", () => {
    expect(readMeasuredSpeedKbps()).toBeNull();
  });

  it("reads bytes over time as kilobits per second", () => {
    recordVideoSegmentSpeed(segment(MB, 1000));
    expect(readMeasuredSpeedKbps()).toBe(8389);
  });

  it("moves toward new readings without jumping", () => {
    recordVideoSegmentSpeed(segment(MB, 1000));
    recordVideoSegmentSpeed(segment(MB, 4000));
    expect(readMeasuredSpeedKbps()).toBe(Math.round(8389 + (2097 - 8389) * 0.3));
  });

  it("is shared by every profile, because the connection belongs to the computer", () => {
    window.__FLOW_PROFILE__ = { id: "study", isDefault: false };
    recordVideoSegmentSpeed(segment(MB, 1000));
    window.__FLOW_PROFILE__ = { id: "", isDefault: true };
    expect(readMeasuredSpeedKbps()).toBe(8389);
    delete window.__FLOW_PROFILE__;
  });

  it.each([
    ["audio", segment(MB, 1000, { mediaType: "audio" })],
    ["an init segment", segment(MB, 1000, { request: { type: "InitializationSegment", bytesLoaded: MB, startDate: new Date(1), endDate: new Date(2) } })],
    ["a small segment, mostly latency", segment(1024, 1000)],
    ["a failed download", segment(MB, 1000, { error: new Error("nope") })],
    ["no timing", segment(MB, 1000, { request: { type: "MediaSegment", bytesLoaded: MB } })],
    ["zero elapsed time", segment(MB, 0)],
    ["no event", undefined],
  ])("ignores %s", (_name, event) => {
    recordVideoSegmentSpeed(event);
    expect(readMeasuredSpeedKbps()).toBeNull();
  });

  it("ignores a stored value that makes no sense", () => {
    window.localStorage.setItem("dash_measured_speed_kbps", "fast");
    expect(readMeasuredSpeedKbps()).toBeNull();
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readMeasuredSpeedKbps()).toBeNull();
    expect(() => recordVideoSegmentSpeed(segment(MB, 1000))).not.toThrow();
  });
});
