import { describe, expect, it } from "vitest";
import { uniqueVideoKeys } from "./videoKeys";
import type { VideoSummary } from "../types/video";

const video = (id: string): VideoSummary => ({ id, title: id, channelName: "c" });

describe("uniqueVideoKeys", () => {
  it("keeps a video's key when others are inserted above it", () => {
    const before = uniqueVideoKeys([video("a"), video("b")]);
    const after = uniqueVideoKeys([video("new"), video("a"), video("b")]);
    expect(after.slice(1)).toEqual(before);
  });

  it("numbers repeats so every key is unique", () => {
    expect(uniqueVideoKeys([video("a"), video("b"), video("a"), video("a")])).toEqual(["a", "b", "a~1", "a~2"]);
  });
});
