import { describe, expect, it } from "vitest";
import { cachedTranscript, rememberTranscript, rememberView, rememberedView } from "./chaptersPanelMemory";

describe("chaptersPanelMemory", () => {
  it("returns the view only for the video it was saved for", () => {
    rememberView("abc", { tab: "transcript", captionId: "en" });
    expect(rememberedView("abc")).toEqual({ tab: "transcript", captionId: "en" });
    expect(rememberedView("other")).toBeNull();
    expect(rememberedView(undefined)).toBeNull();
  });

  it("keeps the most recent transcripts and drops the oldest", () => {
    for (let i = 0; i < 9; i += 1) rememberTranscript(`url-${i}`, [{ start: i, end: i + 1, text: `cue ${i}` }]);
    expect(cachedTranscript("url-0")).toBeNull();
    expect(cachedTranscript("url-8")?.[0]?.text).toBe("cue 8");
  });

  it("counts a transcript saved again as recent", () => {
    rememberTranscript("keep", []);
    for (let i = 0; i < 7; i += 1) rememberTranscript(`fill-${i}`, []);
    rememberTranscript("keep", []);
    rememberTranscript("push", []);
    expect(cachedTranscript("keep")).not.toBeNull();
  });
});
