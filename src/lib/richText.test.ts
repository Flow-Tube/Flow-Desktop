import { describe, expect, it } from "vitest";
import { linkifyPlain, markFound, richSegments, sliceRich } from "./richText";
import type { RichText as RichTextValue } from "../types/video";

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

describe("richSegments with styles", () => {
  it("cuts text and links where a style starts or ends", () => {
    const segments = richSegments({
      text: "so bold and a link here",
      spans: [{ start: 14, length: 4, target: { kind: "url", url: "https://a.b" } }],
      emojis: [],
      styles: [
        { start: 3, length: 4, bold: true, italic: false, strikethrough: false },
        { start: 16, length: 7, bold: false, italic: true, strikethrough: false },
      ],
    });
    expect(segments.map((s) => [s.text, s.target?.kind ?? null, s.style ?? null])).toEqual([
      ["so ", null, null],
      ["bold", null, { bold: true, italic: false, strikethrough: false }],
      [" and a ", null, null],
      ["li", "url", null],
      ["nk", "url", { bold: false, italic: true, strikethrough: false }],
      [" here", null, { bold: false, italic: true, strikethrough: false }],
    ]);
  });
});

describe("inserted icons and highlights", () => {
  it("puts an icon inserted at a link's start before the link, both on the link's chip", () => {
    const rich = {
      text: "Find me @rick now",
      spans: [{ start: 8, length: 5, target: { kind: "channel" as const, channelId: "UC1" } }],
      emojis: [{ start: 8, length: 0, imageUrl: "https://e/a.png", label: "" }],
      highlights: [{ start: 8, length: 5 }],
    };
    const segments = richSegments(rich);
    expect(segments.map((segment) => [segment.text, Boolean(segment.emoji), Boolean(segment.target), segment.highlight])).toEqual([
      ["Find me ", false, false, undefined],
      ["", true, false, 0],
      ["@rick", false, true, 0],
      [" now", false, false, undefined],
    ]);
  });

  it("splits a link around an icon inserted inside it, keeping the link on both halves", () => {
    const rich = {
      text: "Twitch: \u00a0/ linus\u00a0",
      spans: [{ start: 8, length: 9, target: { kind: "url" as const, url: "https://twitch.tv/linus" } }],
      emojis: [{ start: 9, length: 0, imageUrl: "https://e/t.png", label: "" }],
      highlights: [{ start: 8, length: 9 }],
    };
    expect(richSegments(rich).map((segment) => [segment.text, Boolean(segment.emoji), segment.target?.kind, segment.highlight])).toEqual([
      ["Twitch: ", false, undefined, undefined],
      ["\u00a0", false, "url", 0],
      ["", true, undefined, 0],
      ["/ linus\u00a0", false, "url", 0],
    ]);
  });

  it("slices runs with the text", () => {
    const rich = { text: "ab #tag cd", spans: [{ start: 3, length: 4, target: { kind: "hashtag" as const, tag: "#tag" } }], emojis: [] };
    expect(sliceRich(rich, 3, 10).spans).toEqual([{ start: 0, length: 4, target: { kind: "hashtag", tag: "#tag" } }]);
  });
});

describe("markFound", () => {
  const rich = (text: string, spans: RichTextValue["spans"] = []): RichTextValue => ({ text, spans, emojis: [] });
  const marked = (value: RichTextValue, ranges: { start: number; end: number }[]) =>
    markFound(richSegments(value), ranges).map((piece) => [piece.text, Boolean(piece.found), Boolean(piece.target)]);

  it("marks the found stretch and cuts the text around it", () => {
    expect(marked(rich("the name is Jinwoo"), [{ start: 12, end: 18 }])).toEqual([
      ["the name is ", false, false],
      ["Jinwoo", true, false],
    ]);
  });

  it("keeps a link working across a find that starts inside it", () => {
    const value = rich("watch 1:23 now", [{ start: 6, length: 4, target: { kind: "timestamp", seconds: 83 } }]);
    expect(marked(value, [{ start: 8, end: 14 }])).toEqual([
      ["watch ", false, false],
      ["1:", false, true],
      ["23", true, true],
      [" now", true, false],
    ]);
  });

  it("leaves the pieces alone without finds", () => {
    const value = rich("plain");
    expect(markFound(richSegments(value), [])).toEqual(richSegments(value));
  });
});
