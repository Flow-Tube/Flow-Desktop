import { describe, expect, it } from "vitest";

import { localPlaybackError } from "./playability";

const only = (...allowed: string[]) => (mime: string) => allowed.some((text) => mime.includes(text));

describe("localPlaybackError", () => {
  it("lets a playable file through", () => {
    expect(localPlaybackError({ videoCodec: "h264", audioCodec: "aac" }, only("avc1", "mp4a"))).toBeNull();
  });

  it("names a sound format the webview can't decode, instead of playing silent", () => {
    const error = localPlaybackError({ videoCodec: "h264", audioCodec: "ac3" }, only("avc1", "mp4a"));
    expect(error?.kind).toBe("localAudioUnsupported");
    expect(error?.message).toContain("ac3");
  });

  it("names a picture format the webview can't decode", () => {
    expect(localPlaybackError({ videoCodec: "hevc", audioCodec: "aac" }, only("mp4a"))?.kind).toBe(
      "localVideoUnsupported",
    );
  });

  it("a silent video is fine, and a codec nobody listed gets to try", () => {
    expect(localPlaybackError({ videoCodec: "h264", audioCodec: "" }, only("avc1"))).toBeNull();
    expect(localPlaybackError({ videoCodec: "theora", audioCodec: "speex" }, only())).toBeNull();
  });
});
