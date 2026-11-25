import { describe, expect, it } from "vitest";

import type { RichText } from "../types/video";
import { descriptionBlocks, videoCardTitle } from "./descriptionBlocks";

const video = (videoId: string) => ({ kind: "video" as const, videoId, startSeconds: null });

describe("descriptionBlocks", () => {
  it("lifts a video link that ends its line into a card, keeping its label as text", () => {
    const text = "Watch next:\n• Part two...\nThanks for watching";
    const start = text.indexOf("•");
    const rich: RichText = { text, spans: [{ start, length: "• Part two...".length, target: video("abc") }], emojis: [] };
    expect(descriptionBlocks(rich, "own")).toEqual([
      { kind: "text", text: { text: "Watch next:", spans: [], emojis: [], styles: [], highlights: [] } },
      { kind: "video", videoId: "abc", startSeconds: null, title: "Part two" },
      { kind: "text", text: { text: "Thanks for watching", spans: [], emojis: [], styles: [], highlights: [] } },
    ]);
  });

  it("leaves a link inside a sentence and a link to this video inline", () => {
    const text = "See this video for more.\nAt 1:00 here";
    const inline: RichText = { text, spans: [{ start: 4, length: 10, target: video("abc") }], emojis: [] };
    expect(descriptionBlocks(inline, "own")).toEqual([{ kind: "text", text: inline }]);
    const own: RichText = { text: "Again\nlink", spans: [{ start: 6, length: 4, target: video("own") }], emojis: [] };
    expect(descriptionBlocks(own, "own")).toEqual([{ kind: "text", text: own }]);
  });

  it("cleans the server's link text into a title", () => {
    expect(videoCardTitle("  • Never Gonna…  ")).toBe("Never Gonna");
  });
});
