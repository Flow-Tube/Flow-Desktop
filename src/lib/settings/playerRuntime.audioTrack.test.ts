import { describe, expect, it } from "vitest";

import type { AudioTrack } from "../../types/video";
import { selectPreferredAudioTrackId } from "./playerRuntime";

const track = (id: string, languageCode: string, available = true) =>
  ({ id, label: id, languageCode, localUrl: id, isDefault: id === "orig", available }) as AudioTrack;

const tracks = [track("orig", "en"), track("spanish", "es-US"), track("french", "fr", false)];

describe("selectPreferredAudioTrackId", () => {
  it("leaves the original track playing by default", () => {
    expect(selectPreferredAudioTrackId(tracks, "original")).toBeNull();
  });

  it("picks the chosen language, with or without a region", () => {
    expect(selectPreferredAudioTrackId(tracks, "es")).toBe("spanish");
    expect(selectPreferredAudioTrackId(tracks, "es-US")).toBe("spanish");
  });

  it("falls back to the original when that language can't play or doesn't exist", () => {
    expect(selectPreferredAudioTrackId(tracks, "fr")).toBeNull();
    expect(selectPreferredAudioTrackId(tracks, "ja")).toBeNull();
  });
});
