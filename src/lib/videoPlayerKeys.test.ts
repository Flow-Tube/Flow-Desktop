import { describe, expect, it } from "vitest";

import { videoPlayerKeyAction as actionFor } from "./videoPlayerKeys";

const videoPlayerKeyAction = (key: string, shiftKey = false) => actionFor({ key, shiftKey });

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

  it("zooms with Z, Shift+Z and X", () => {
    expect(videoPlayerKeyAction("z")).toEqual({ kind: "zoom-in" });
    expect(videoPlayerKeyAction("Z", true)).toEqual({ kind: "zoom-out" });
    expect(videoPlayerKeyAction("x")).toEqual({ kind: "zoom-reset" });
  });

  it("adds loop, resize, frame, stats, like and Watch later keys", () => {
    expect(videoPlayerKeyAction("r")).toEqual({ kind: "toggle-loop" });
    expect(videoPlayerKeyAction("o")).toEqual({ kind: "next-resize" });
    expect(videoPlayerKeyAction("S", true)).toEqual({ kind: "save-frame" });
    expect(videoPlayerKeyAction("I", true)).toEqual({ kind: "toggle-stats" });
    expect(videoPlayerKeyAction("L", true)).toEqual({ kind: "watch", command: "like" });
    expect(videoPlayerKeyAction("W", true)).toEqual({ kind: "watch", command: "watch-later" });
    // Lower-case l still seeks and w still looks around.
    expect(videoPlayerKeyAction("l")).toEqual({ kind: "seek-forward" });
    expect(videoPlayerKeyAction("w")).toEqual({ kind: "look", key: "w" });
  });
});
