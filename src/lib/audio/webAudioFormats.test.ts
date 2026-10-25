import { describe, expect, it } from "vitest";

import { webAudioHears } from "./webAudioFormats";

describe("webAudioHears", () => {
  it("hears MP4 audio on macOS", () => {
    expect(webAudioHears('audio/mp4; codecs="mp4a.40.2"', true)).toBe(true);
    expect(webAudioHears("audio/mpeg", true)).toBe(true);
  });

  it("does not hear WebM or Ogg on macOS", () => {
    expect(webAudioHears('audio/webm; codecs="opus"', true)).toBe(false);
    expect(webAudioHears("audio/ogg", true)).toBe(false);
  });

  it("hears every format elsewhere", () => {
    expect(webAudioHears('audio/webm; codecs="opus"', false)).toBe(true);
  });

  it("assumes an unknown format is heard", () => {
    expect(webAudioHears(null, true)).toBe(true);
  });
});
