import { describe, expect, it } from "vitest";

import { VIDEO_KEY_BINDINGS, videoPlayerKeyAction } from "./videoPlayerKeys";

describe("videoPlayerKeyAction", () => {
  it("maps YouTube's player keys", () => {
    expect(videoPlayerKeyAction(" ")).toEqual({ kind: "toggle-play" });
    expect(videoPlayerKeyAction("K")).toEqual({ kind: "toggle-play" });
    expect(videoPlayerKeyAction("j")).toEqual({ kind: "seek-back" });
    expect(videoPlayerKeyAction("ArrowRight")).toEqual({ kind: "seek-forward" });
    expect(videoPlayerKeyAction("ArrowUp")).toEqual({ kind: "volume-up" });
    expect(videoPlayerKeyAction("m")).toEqual({ kind: "toggle-mute" });
    expect(videoPlayerKeyAction("f")).toEqual({ kind: "toggle-fullscreen" });
    expect(videoPlayerKeyAction("Escape")).toEqual({ kind: "exit-fullscreen" });
    expect(videoPlayerKeyAction("[")).toEqual({ kind: "previous-chapter" });
    expect(videoPlayerKeyAction("End")).toEqual({ kind: "seek-end" });
    expect(videoPlayerKeyAction("4")).toEqual({ kind: "seek-to-fraction", fraction: 0.4 });
    expect(videoPlayerKeyAction("w")).toEqual({ kind: "look", key: "w" });
  });

  it("needs Shift for next and previous only", () => {
    expect(videoPlayerKeyAction("N", true)).toEqual({ kind: "next" });
    expect(videoPlayerKeyAction("n")).toBeNull();
    expect(videoPlayerKeyAction("P", true)).toEqual({ kind: "previous" });
  });

  it("reads characters that need Shift as they are typed", () => {
    expect(videoPlayerKeyAction("<", true)).toEqual({ kind: "slower" });
    expect(videoPlayerKeyAction(">", true)).toEqual({ kind: "faster" });
    expect(videoPlayerKeyAction("+", true)).toEqual({ kind: "captions-larger" });
    expect(videoPlayerKeyAction("=")).toEqual({ kind: "captions-larger" });
  });

  it("ignores keys it doesn't know", () => {
    expect(videoPlayerKeyAction("q")).toBeNull();
    expect(videoPlayerKeyAction("Tab")).toBeNull();
  });

  it("gives every key one meaning", () => {
    const keys = VIDEO_KEY_BINDINGS.flatMap((binding) => binding.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
