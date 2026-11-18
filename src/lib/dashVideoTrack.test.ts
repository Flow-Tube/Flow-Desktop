import { describe, expect, it } from "vitest";
import type { StreamVariant } from "../types/video";
import {
  allVideoRepresentations,
  autoBitrateCapKbps,
  autoQualityBox,
  autoRepresentationToSwitchTo,
  droppedLastAdaptationSet,
  nearestSupportedQuality,
  pickAutoVideoTrack,
  representationLabel,
  representationLabelWithCodec,
  settleAutoVideoTrack,
  type DashVideoTrack,
} from "./dashVideoTrack";

const track = (id: string, codec: string, heights: number[]): DashVideoTrack => ({
  id,
  codec: `video/mp4;codecs="${codec}"`,
  bitrateList: heights.map((height) => ({
    id: `${id}-${height}`,
    height,
    width: Math.round((height * 16) / 9),
    bandwidth: height * 4000,
  })),
});

const h264 = track("video-h264-mp4", "avc1.640028", [144, 720, 1080]);
const vp9 = track("video-vp9-webm", "vp09.00.10.08", [144, 720, 1080, 2160]);
const av1 = track("video-av1-mp4", "av01.0.12M.08", [144, 720, 1080, 2160]);
const av1Hdr = track("video-av1-hdr-mp4", "av01.0.17M.10", [144, 1080, 4320]);

describe("pickAutoVideoTrack", () => {
  it("goes for the set reaching the highest resolution, even with H.264 preferred", () => {
    expect(pickAutoVideoTrack([h264, vp9], "H.264")?.id).toBe(vp9.id);
  });

  it("stays on H.264 when nothing goes higher", () => {
    const vp91080 = track("video-vp9-webm", "vp09.00.10.08", [1080]);
    expect(pickAutoVideoTrack([h264, vp91080], "Auto")?.id).toBe(h264.id);
  });

  it("settles a tie by the preferred codec, then the most widely decoded", () => {
    expect(pickAutoVideoTrack([h264, av1, vp9], "H.264")?.id).toBe(vp9.id);
    expect(pickAutoVideoTrack([h264, av1, vp9], "AV1")?.id).toBe(av1.id);
  });

  it("leaves HDR out, even when it reaches higher", () => {
    expect(pickAutoVideoTrack([h264, vp9, av1Hdr], "Auto")?.id).toBe(vp9.id);
  });

  it("falls back to HDR when a video has nothing else", () => {
    expect(pickAutoVideoTrack([av1Hdr], "Auto")?.id).toBe(av1Hdr.id);
    expect(pickAutoVideoTrack([], "Auto")).toBeNull();
  });

  it("uses what's left when a machine can't decode a set", () => {
    expect(pickAutoVideoTrack([h264], "Auto")?.id).toBe(h264.id);
  });
});

describe("autoRepresentationToSwitchTo", () => {
  it("moves to the nearest height in the Auto set", () => {
    expect(autoRepresentationToSwitchTo(vp9, { id: "video-h264-mp4-720", height: 720 })).toBe("video-vp9-webm-720");
  });

  it("stays put when already in the Auto set", () => {
    expect(autoRepresentationToSwitchTo(vp9, { id: "video-vp9-webm-720", height: 720 })).toBeNull();
  });

  it("does nothing without a set or a current representation", () => {
    expect(autoRepresentationToSwitchTo(null, { id: "x", height: 720 })).toBeNull();
    expect(autoRepresentationToSwitchTo(vp9, null)).toBeNull();
  });
});

describe("allVideoRepresentations", () => {
  it("lists every set, with each set's codec", () => {
    const all = allVideoRepresentations([h264, av1Hdr]);
    expect(all).toHaveLength(6);
    expect(all.find((item) => item.id === "video-av1-hdr-mp4-4320")).toMatchObject({
      height: 4320,
      codecs: av1Hdr.codec,
    });
  });
});

describe("labels", () => {
  const qualities = [
    { id: "137", qualityLabel: "1080p60", mimeType: 'video/mp4; codecs="avc1.640028"' },
  ] as StreamVariant[];

  it("uses YouTube's name rather than the raw height of a wide film", () => {
    expect(representationLabel({ id: "137", height: 960 }, qualities)).toBe("1080p60");
    expect(representationLabel({ id: "other", height: 960 }, qualities)).toBe("960p");
  });

  it("adds the codec only where asked", () => {
    expect(representationLabelWithCodec({ id: "137", height: 960 }, qualities, "x")).toBe("1080p60 (H.264)");
    expect(representationLabelWithCodec({ id: "other" }, [], "720p")).toBe("720p");
  });
});

describe("droppedLastAdaptationSet", () => {
  it("is a failure only when no set of that type is left", () => {
    expect(droppedLastAdaptationSet({ remainingAdaptationSets: [{}] })).toBe(false);
    expect(droppedLastAdaptationSet({ remainingAdaptationSets: [] })).toBe(true);
    expect(droppedLastAdaptationSet({})).toBe(true);
  });
});

describe("nearestSupportedQuality", () => {
  const row = (id: string, height: number, label = `${height}p`) => ({ id, height, qualityLabel: label }) as StreamVariant;
  const supported = [row("702", 4320, "4320p HDR"), row("701", 2160, "2160p HDR"), row("315", 2160), row("299", 1080)];

  it("stays at the chosen height instead of jumping to the top of the list", () => {
    expect(nearestSupportedQuality(row("337", 2160, "2160p HDR"), supported)?.height).toBe(2160);
  });

  it("doesn't turn a normal row into HDR", () => {
    expect(nearestSupportedQuality(row("x", 2160), supported)?.id).toBe("315");
  });

  it("has nothing to do without a chosen row", () => {
    expect(nearestSupportedQuality(undefined, supported)).toBeUndefined();
  });
});

describe("Auto held to the player's size", () => {
  // A 900 px wide player on a 2x screen: 1800 by 1012 device pixels.
  const laptopPlayer = autoQualityBox(900, 506, 2, false);
  const fullscreen4k = autoQualityBox(1920, 1080, 2, false);
  const miniPlayer = autoQualityBox(400, 225, 1, false);

  it("measures the player in device pixels, and has no limit before it has a size", () => {
    expect(laptopPlayer).toEqual({ width: 1800, height: 1012 });
    expect(autoQualityBox(0, 0, 2, false)).toBeNull();
  });

  it("stays in the H.264 set when 1080p fills the player", () => {
    expect(pickAutoVideoTrack([h264, vp9], "H.264", laptopPlayer)?.id).toBe(h264.id);
    expect(pickAutoVideoTrack([h264, av1, vp9], "Auto", laptopPlayer)?.id).toBe(h264.id);
  });

  it("moves to a set that reaches further only when the player needs it", () => {
    expect(pickAutoVideoTrack([h264, vp9], "H.264", fullscreen4k)?.id).toBe(vp9.id);
    expect(pickAutoVideoTrack([h264, av1, vp9], "AV1", fullscreen4k)?.id).toBe(av1.id);
  });

  it("falls back to the tallest set when nothing fills the player", () => {
    const sd = track("video-h264-mp4", "avc1.4d401e", [144, 360]);
    const hd = track("video-vp9-webm", "vp09.00.10.08", [144, 720]);
    expect(pickAutoVideoTrack([sd, hd], "H.264", fullscreen4k)?.id).toBe(hd.id);
  });

  it("caps the climb at the smallest size that fills the player", () => {
    expect(autoBitrateCapKbps(h264, laptopPlayer)).toBe(1080 * 4);
    expect(autoBitrateCapKbps(vp9, fullscreen4k)).toBe(2160 * 4);
    expect(autoBitrateCapKbps(vp9, miniPlayer)).toBe(720 * 4);
  });

  it("lets a picture be stretched by up to a tenth before going a size up", () => {
    // 1280 wide covers a 1400 px player, but not a 1500 px one.
    expect(autoBitrateCapKbps(h264, autoQualityBox(1400, 788, 1, false))).toBe(720 * 4);
    expect(autoBitrateCapKbps(h264, autoQualityBox(1500, 844, 1, false))).toBe(1080 * 4);
  });

  it("has no cap when the set can't fill the player or its size is unknown", () => {
    expect(autoBitrateCapKbps(h264, fullscreen4k)).toBe(-1);
    expect(autoBitrateCapKbps(vp9, null)).toBe(-1);
    expect(autoBitrateCapKbps(null, laptopPlayer)).toBe(-1);
  });

  it("measures a wide film by its width and a vertical video by its height", () => {
    const film: DashVideoTrack = {
      id: "video-h264-mp4",
      codec: 'video/mp4;codecs="avc1.640028"',
      bitrateList: [
        { id: "a", width: 1280, height: 534, bandwidth: 1_000_000 },
        { id: "b", width: 1920, height: 800, bandwidth: 2_000_000 },
      ],
    };
    expect(autoBitrateCapKbps(film, laptopPlayer)).toBe(2000);
    const vertical: DashVideoTrack = {
      id: "video-h264-mp4",
      codec: 'video/mp4;codecs="avc1.640028"',
      bitrateList: [
        { id: "a", width: 406, height: 720, bandwidth: 1_000_000 },
        { id: "b", width: 608, height: 1080, bandwidth: 2_000_000 },
      ],
    };
    expect(autoBitrateCapKbps(vertical, laptopPlayer)).toBe(2000);
  });

  it("stops at 1080p on Linux, whatever the screen", () => {
    const linuxFullscreen = autoQualityBox(1920, 1080, 2, true);
    expect(linuxFullscreen).toEqual({ width: 1920, height: 1080 });
    expect(autoQualityBox(0, 0, 1, true)).toEqual({ width: 1920, height: 1080 });
    expect(pickAutoVideoTrack([h264, vp9], "H.264", linuxFullscreen)?.id).toBe(h264.id);
    expect(autoBitrateCapKbps(h264, linuxFullscreen)).toBe(1080 * 4);
  });
});

describe("settleAutoVideoTrack", () => {
  const small = autoQualityBox(900, 506, 2, false);
  const large = autoQualityBox(1920, 1080, 2, false);

  it("keeps the set that is playing while it still fills the player", () => {
    expect(settleAutoVideoTrack([h264, vp9], "H.264", small, `${vp9.id}-2160`)?.id).toBe(vp9.id);
  });

  it("moves up when the playing set is too small for the player", () => {
    expect(settleAutoVideoTrack([h264, vp9], "H.264", large, `${h264.id}-1080`)?.id).toBe(vp9.id);
  });

  it("picks from scratch when nothing is playing yet", () => {
    expect(settleAutoVideoTrack([h264, vp9], "H.264", small, null)?.id).toBe(h264.id);
  });
});
