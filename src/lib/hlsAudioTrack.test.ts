import { describe, expect, it } from "vitest";
import { hlsAudioChoice, type HlsAudioOption } from "./hlsAudioTrack";
import type { AudioTrack } from "../types/video";

const option = (name: string, lang: string, contentId?: string): HlsAudioOption => ({
  name,
  lang,
  attrs: contentId ? { "YT-EXT-AUDIO-CONTENT-ID": contentId } : {},
});
const track = (id: string, languageCode: string | null) => ({ id, languageCode }) as AudioTrack;

const arabic = option("العربية - dubbed-auto", "ar", "ar.10");
const german = option("Deutsch (Deutschland) - dubbed-auto", "de-DE", "de-DE.10");
const original = option("American English - original", "en-US", "en-US.4");
const options = [arabic, german, original];

describe("hlsAudioChoice", () => {
  it("finds the original by content id, even though a dub comes first", () => {
    expect(hlsAudioChoice(options, track("en-US.4-140", "en-US"))).toEqual({
      name: "American English - original",
      lang: "en-US",
    });
  });

  it("finds a dub the listener chose", () => {
    expect(hlsAudioChoice(options, track("de-DE.10-251", "de-DE"))?.name).toBe(german.name);
  });

  it("tells a dub from an original in the same language by content id", () => {
    const dubbedEnglish = option("American English - dubbed-auto", "en-US", "en-US.10");
    expect(hlsAudioChoice([dubbedEnglish, original], track("en-US.4-140", "en-US"))?.name).toBe(original.name);
  });

  it("falls back to the language when the content id isn't listed", () => {
    expect(hlsAudioChoice([arabic, option("Deutsch", "de-DE")], track("de-DE.3-140", "de-DE"))?.name).toBe("Deutsch");
  });

  it("plays the original when the chosen language isn't on offer", () => {
    expect(hlsAudioChoice(options, track("fr-FR.10-251", "fr-FR"))?.name).toBe(original.name);
  });

  it("plays the original when no audio track is known", () => {
    expect(hlsAudioChoice(options, null)?.name).toBe(original.name);
  });

  it("uses the manifest's default when nothing is marked original", () => {
    const marked = { ...option("Main", "en"), default: true };
    expect(hlsAudioChoice([arabic, marked], null)?.name).toBe("Main");
  });

  it("leaves it to hls.js when there's nothing to go on", () => {
    expect(hlsAudioChoice([{ name: "Default" }], null)).toBeNull();
    expect(hlsAudioChoice([], track("en-US.4-140", "en-US"))).toBeNull();
  });
});
