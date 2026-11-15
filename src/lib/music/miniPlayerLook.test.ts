import { describe, expect, it } from "vitest";

import { DEFAULT_MINI_BAR_BUTTONS, MAX_MINI_BAR_BUTTONS, miniBarButtonLimit, parseMiniBarButtons, serializeMiniBarButtons } from "./miniPlayerLook";

describe("mini player buttons", () => {
  it("uses the defaults when nothing is stored", () => {
    expect(parseMiniBarButtons("")).toEqual(DEFAULT_MINI_BAR_BUTTONS);
  });

  it("keeps the stored order and skips unknown or repeated names", () => {
    expect(parseMiniBarButtons("queue,bogus,next,queue")).toEqual(["queue", "next"]);
  });

  it("keeps at most ten", () => {
    const stored = "previous,play_pause,next,like,add_to_playlist,shuffle,repeat,queue,lyrics,sleep_timer,volume,close";
    expect(parseMiniBarButtons(stored)).toHaveLength(MAX_MINI_BAR_BUTTONS);
    expect(serializeMiniBarButtons(parseMiniBarButtons(stored))).toBe(
      "previous,play_pause,next,like,add_to_playlist,shuffle,repeat,queue,lyrics,sleep_timer",
    );
  });

  it("fits more buttons in a wider pill", () => {
    expect([miniBarButtonLimit("compact"), miniBarButtonLimit("regular"), miniBarButtonLimit("wide")]).toEqual([5, 8, 10]);
  });
});
