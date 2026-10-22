import { describe, expect, it } from "vitest";
import { linkifyPlain, richSegments } from "./richText";

describe("linkifyPlain", () => {
  it("links web addresses, timestamps and hashtags", () => {
    const rich = linkifyPlain("Intro 0:00, chorus 1:02:03 #Pop see https://example.com/a?b=1.");
    expect(rich.spans.map((span) => span.target)).toEqual([
      { kind: "timestamp", seconds: 0 },
      { kind: "timestamp", seconds: 3723 },
      { kind: "hashtag", tag: "#Pop" },
      { kind: "url", url: "https://example.com/a?b=1" },
    ]);
  });

  it("keeps a timestamp inside a link part of the link", () => {
    const rich = linkifyPlain("https://youtu.be/x?t=1:30");
    expect(rich.spans).toHaveLength(1);
    expect(rich.spans[0]?.target.kind).toBe("url");
  });

  it("does not take numbers or anchors for hashtags", () => {
    expect(linkifyPlain("issue #123 and a#b").spans).toEqual([]);
  });
});

describe("richSegments", () => {
  it("cuts text around links and custom emoji, by UTF-16 offset", () => {
    const segments = richSegments({
      text: "😭 see 1:05 :yt:",
      spans: [{ start: 7, length: 4, target: { kind: "timestamp", seconds: 65 } }],
      emojis: [{ start: 12, length: 4, imageUrl: "https://e/yt.png", label: "yt" }],
    });
    expect(segments.map((segment) => segment.text)).toEqual(["😭 see ", "1:05", " ", ":yt:"]);
    expect(segments[1]?.target).toEqual({ kind: "timestamp", seconds: 65 });
    expect(segments[3]?.emoji?.label).toBe("yt");
  });

  it("drops a run that overlaps an earlier one", () => {
    const segments = richSegments({
      text: "abcdef",
      spans: [
        { start: 0, length: 4, target: { kind: "url", url: "https://a" } },
        { start: 2, length: 3, target: { kind: "url", url: "https://b" } },
      ],
      emojis: [],
    });
    expect(segments.map((segment) => segment.text)).toEqual(["abcd", "ef"]);
  });
});
