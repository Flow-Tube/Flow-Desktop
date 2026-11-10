import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  codecFamily,
  codecToLeaveAfterDecodeError,
  deviceSupportsCodec,
  isCodecFailingOnDevice,
  isCodecRuledOut,
  loadDecodeFailures,
  saveDecodeFailures,
  withDecodeFailure,
  withoutRuledOutCodecs,
  type DecodeFailures,
} from "./codecHealth";
import type { StreamVariant } from "../types/video";

const DAY = 24 * 60 * 60 * 1000;
const AV1 = 'video/mp4; codecs="av01.0.00M.08"';

const failed = (videos: string[], directStart = true, now = 1000): DecodeFailures =>
  videos.reduce<DecodeFailures>((all, id) => withDecodeFailure(all, "av1", id, directStart, now), {});

const variant = (mimeType: string, isVideoOnly = true) => ({ mimeType, isVideoOnly }) as StreamVariant;

describe("codecFamily", () => {
  it.each([
    ['video/mp4; codecs="avc1.640028"', "h264"],
    ['video/webm; codecs="vp09.00.10.08"', "vp9"],
    ['video/webm; codecs="vp9"', "vp9"],
    [AV1, "av1"],
    ["audio/mp4", null],
    [null, null],
  ])("reads %s as %s", (codec, family) => {
    expect(codecFamily(codec)).toBe(family);
  });
});

describe("deviceSupportsCodec", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("follows what the browser says", () => {
    vi.stubGlobal("MediaSource", { isTypeSupported: (type: string) => !type.includes("av01") });
    expect(deviceSupportsCodec("av1")).toBe(false);
    expect(deviceSupportsCodec("h264")).toBe(true);
  });

  it("counts VP9 as supported in either container", () => {
    vi.stubGlobal("MediaSource", { isTypeSupported: (type: string) => type.startsWith("video/mp4") });
    expect(deviceSupportsCodec("vp9")).toBe(true);
  });

  it("greys nothing out when the browser can't say", () => {
    vi.stubGlobal("MediaSource", undefined);
    expect(deviceSupportsCodec("av1")).toBe(true);
  });
});

describe("ruling a codec out", () => {
  it("rules it out only for the video that failed", () => {
    const failures = failed(["a"]);
    expect(isCodecRuledOut(failures, AV1, "a", 2000)).toBe(true);
    expect(isCodecRuledOut(failures, AV1, "b", 2000)).toBe(false);
    expect(isCodecFailingOnDevice(failures, "av1", 2000)).toBe(false);
  });

  it("leaves other codecs alone", () => {
    expect(isCodecRuledOut(failed(["a"]), 'video/mp4; codecs="avc1.640028"', "a", 2000)).toBe(false);
  });

  it("rules it out everywhere after three videos fail on a direct start", () => {
    const failures = failed(["a", "b", "c"]);
    expect(isCodecFailingOnDevice(failures, "av1", 2000)).toBe(true);
    expect(isCodecRuledOut(failures, AV1, "another", 2000)).toBe(true);
  });

  it("never blames the device for failures right after a codec hop", () => {
    const failures = failed(["a", "b", "c", "d"], false);
    expect(isCodecFailingOnDevice(failures, "av1", 2000)).toBe(false);
    expect(isCodecRuledOut(failures, AV1, "a", 2000)).toBe(true);
    expect(isCodecRuledOut(failures, AV1, "another", 2000)).toBe(false);
  });

  it("counts one video once, however often it fails", () => {
    expect(isCodecFailingOnDevice(failed(["a", "a", "a"]), "av1", 2000)).toBe(false);
  });

  it("forgets after 30 days", () => {
    const failures = failed(["a", "b", "c"]);
    expect(isCodecFailingOnDevice(failures, "av1", 1000 + 30 * DAY)).toBe(false);
    expect(isCodecRuledOut(failures, AV1, "a", 1000 + 30 * DAY)).toBe(false);
  });

  it("keeps the record small", () => {
    const ids = Array.from({ length: 60 }, (_, index) => `v${index}`);
    expect(failed(ids).av1).toHaveLength(50);
  });
});

describe("withoutRuledOutCodecs", () => {
  const h264 = { codec: 'video/mp4;codecs="avc1.640028"' };
  const av1 = { codec: 'video/mp4;codecs="av01.0.08M.08"' };

  it("drops the failed codec for that video", () => {
    expect(withoutRuledOutCodecs([h264, av1], failed(["a"], true, Date.now()), "a")).toEqual([h264]);
  });

  it("keeps everything for another video", () => {
    expect(withoutRuledOutCodecs([h264, av1], failed(["a"], true, Date.now()), "b")).toEqual([h264, av1]);
  });

  it("would rather keep a failed codec than have no video", () => {
    expect(withoutRuledOutCodecs([av1], failed(["a"], true, Date.now()), "a")).toEqual([av1]);
  });
});

describe("codecToLeaveAfterDecodeError", () => {
  const h264 = variant('video/mp4; codecs="avc1.640028"');
  const vp9 = variant('video/webm; codecs="vp09.00.10.08"');
  const av1 = variant(AV1);

  it("leaves AV1 when another codec is on offer", () => {
    expect(codecToLeaveAfterDecodeError(AV1, [av1, h264])).toBe("av1");
  });

  it("leaves VP9 too", () => {
    expect(codecToLeaveAfterDecodeError(vp9.mimeType, [vp9, h264])).toBe("vp9");
  });

  it("hands H.264 failures to the source fallback, as there's nothing better to try", () => {
    expect(codecToLeaveAfterDecodeError(h264.mimeType, [av1, h264])).toBeNull();
  });

  it("hands it over when the video has only that codec", () => {
    expect(codecToLeaveAfterDecodeError(AV1, [av1])).toBeNull();
  });

  it("doesn't count a muxed format as an alternative, since DASH can't play it", () => {
    expect(codecToLeaveAfterDecodeError(AV1, [av1, variant('video/mp4; codecs="avc1.42001E"', false)])).toBeNull();
  });

  it("hands it over when the current codec is unknown", () => {
    expect(codecToLeaveAfterDecodeError(undefined, [av1, h264])).toBeNull();
  });
});

describe("stored failures", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("round-trips, shared by every profile", () => {
    const failures = failed(["a"]);
    window.__FLOW_PROFILE__ = { id: "study", isDefault: false };
    saveDecodeFailures(failures);
    window.__FLOW_PROFILE__ = { id: "", isDefault: true };
    expect(loadDecodeFailures()).toEqual(failures);
    delete window.__FLOW_PROFILE__;
  });

  it("starts empty when nothing is stored or it can't be read", () => {
    expect(loadDecodeFailures()).toEqual({});
    window.localStorage.setItem("video_decode_failures", "not json");
    expect(loadDecodeFailures()).toEqual({});
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadDecodeFailures()).toEqual({});
    expect(() => saveDecodeFailures(failed(["a"]))).not.toThrow();
  });
});
