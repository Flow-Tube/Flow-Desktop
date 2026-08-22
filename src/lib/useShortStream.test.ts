import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  pickAdaptiveVideoUrl,
  pickAudioUrl,
  pickDirectUrl,
  selectShortPlaybackSource,
} from "./useShortStream";
import { codecRank } from "./codecPreference";
import type { AudioTrack, StreamInfo, StreamVariant } from "../types/video";

function makeVariant(overrides: Partial<StreamVariant>): StreamVariant {
  return {
    id: "v",
    localUrl: "http://127.0.0.1:9/stream/v",
    qualityLabel: "720p",
    mimeType: 'video/mp4; codecs="avc1.4d401f"',
    width: 720,
    height: 1280,
    fps: 30,
    bitrate: 1_000_000,
    isDefault: false,
    isPlayable: true,
    hasAudio: false,
    isVideoOnly: true,
    deliveryMethod: "progressive",
    ...overrides,
  };
}

function makeAudio(overrides: Partial<AudioTrack>): AudioTrack {
  return {
    id: "a",
    label: "Original",
    localUrl: "http://127.0.0.1:9/stream/a",
    mimeType: 'audio/mp4; codecs="mp4a.40.2"',
    bitrate: 128_000,
    isDefault: true,
    available: true,
    ...overrides,
  };
}

function makeInfo(overrides: Partial<StreamInfo>): StreamInfo {
  return {
    streamId: "s",
    localUrl: "http://127.0.0.1:9/stream/main",
    expiresAt: "",
    variants: [],
    captions: [],
    audioTracks: [],
    dashManifestUrl: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("codecRank", () => {
  it("prefers H.264, then VP9, then AV1, then unknown", () => {
    expect(codecRank('video/mp4; codecs="avc1.4d401f"')).toBe(0);
    expect(codecRank('video/webm; codecs="vp09.00.10.08"')).toBe(1);
    expect(codecRank('video/mp4; codecs="av01.0.05M.08"')).toBe(2);
    expect(codecRank("video/quicktime")).toBe(3);
    expect(codecRank(null)).toBe(3);
  });
});

describe("pickAdaptiveVideoUrl", () => {
  it("prefers H.264 over VP9 at similar resolution", () => {
    const info = makeInfo({
      variants: [
        makeVariant({ localUrl: "url-vp9", mimeType: 'video/webm; codecs="vp09"', height: 1280 }),
        makeVariant({ localUrl: "url-h264", mimeType: 'video/mp4; codecs="avc1"', height: 1280 }),
      ],
    });
    expect(pickAdaptiveVideoUrl(info)).toBe("url-h264");
  });

  it("drops variants the player cannot decode", () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockImplementation((mime) =>
      mime.includes("av01") ? "" : "probably",
    );
    const info = makeInfo({
      variants: [
        makeVariant({ localUrl: "url-av1", mimeType: 'video/mp4; codecs="av01"', height: 1440 }),
        makeVariant({ localUrl: "url-h264", mimeType: 'video/mp4; codecs="avc1"', height: 720 }),
      ],
    });
    expect(pickAdaptiveVideoUrl(info)).toBe("url-h264");
  });

  it("ignores muxed and audio-bearing variants", () => {
    const info = makeInfo({
      variants: [makeVariant({ isVideoOnly: false, hasAudio: true, localUrl: "muxed" })],
    });
    expect(pickAdaptiveVideoUrl(info)).toBeNull();
  });
});

describe("pickDirectUrl", () => {
  it("picks the highest playable muxed variant", () => {
    const info = makeInfo({
      variants: [
        makeVariant({ isVideoOnly: false, hasAudio: true, localUrl: "muxed-360", height: 360 }),
        makeVariant({ isVideoOnly: false, hasAudio: true, localUrl: "muxed-720", height: 720 }),
      ],
    });
    expect(pickDirectUrl(info)).toBe("muxed-720");
  });
});

describe("pickAudioUrl", () => {
  it("prefers the default available track", () => {
    const info = makeInfo({
      audioTracks: [
        makeAudio({ localUrl: "audio-alt", isDefault: false }),
        makeAudio({ localUrl: "audio-main", isDefault: true }),
      ],
    });
    expect(pickAudioUrl(info)).toBe("audio-main");
  });

  it("skips unavailable tracks", () => {
    const info = makeInfo({ audioTracks: [makeAudio({ available: false, localUrl: "nope" })] });
    expect(pickAudioUrl(info)).toBeNull();
  });
});

describe("selectShortPlaybackSource", () => {
  it("returns the adaptive video + separate audio pair when available", () => {
    const info = makeInfo({
      dashManifestUrl: "dash",
      variants: [makeVariant({ localUrl: "video-only", isVideoOnly: true })],
      audioTracks: [makeAudio({ localUrl: "audio" })],
    });
    expect(selectShortPlaybackSource(info)).toEqual({
      dashUrl: "dash",
      videoUrl: "video-only",
      audioUrl: "audio",
    });
  });

  it("falls back to a muxed direct url when no adaptive video exists", () => {
    const info = makeInfo({
      dashManifestUrl: "dash",
      variants: [makeVariant({ isVideoOnly: false, hasAudio: true, localUrl: "muxed" })],
    });
    expect(selectShortPlaybackSource(info)).toEqual({
      dashUrl: "dash",
      videoUrl: "muxed",
      audioUrl: null,
    });
  });
});
