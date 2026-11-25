import { describe, expect, it } from "vitest";
import {
  cachedTranscript,
  clearRequestedTab,
  onTabRequest,
  rememberTranscript,
  rememberView,
  rememberedView,
  requestTab,
  requestedTabFor,
} from "./chaptersPanelMemory";

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

describe("tab requests", () => {
  it("hands a requested tab to an open panel, or keeps it for the next one to mount", () => {
    requestTab("v1", "transcript");
    expect(requestedTabFor("v1")).toBe("transcript");
    expect(requestedTabFor("v2")).toBeNull();
    clearRequestedTab("v1");
    expect(requestedTabFor("v1")).toBeNull();

    const seen: string[] = [];
    const stop = onTabRequest((id, tab) => {
      seen.push(`${id}:${tab}`);
      return id === "v1";
    });
    requestTab("v1", "chapters");
    expect(seen).toEqual(["v1:chapters"]);
    expect(requestedTabFor("v1")).toBeNull();
    requestTab("v2", "transcript");
    expect(requestedTabFor("v2")).toBe("transcript");
    stop();
  });
});
