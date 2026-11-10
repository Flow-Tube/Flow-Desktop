import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerMediaSessionClient, runMediaCommand, type MediaSessionClient } from "./mediaSessionArbiter";

function client(playing: boolean): MediaSessionClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    metadata: () => null,
    isPlaying: () => playing,
    position: () => null,
    pause: () => {},
    actions: {
      play: () => calls.push("play"),
      pause: () => calls.push("pause"),
      nexttrack: () => calls.push("next"),
      previoustrack: () => calls.push("previous"),
    },
  };
}

describe("runMediaCommand", () => {
  let unregister: (() => void) | null = null;
  beforeEach(() => {
    vi.stubGlobal("navigator", {});
  });
  afterEach(() => {
    unregister?.();
    unregister = null;
    vi.unstubAllGlobals();
  });

  it("toggles on the player's state", () => {
    const playing = client(true);
    unregister = registerMediaSessionClient("video", playing);
    expect(runMediaCommand("toggle")).toBe(true);
    expect(playing.calls).toEqual(["pause"]);
    unregister();

    const paused = client(false);
    unregister = registerMediaSessionClient("music", paused);
    runMediaCommand("toggle");
    expect(paused.calls).toEqual(["play"]);
  });

  it("moves through the queue", () => {
    const player = client(true);
    unregister = registerMediaSessionClient("music", player);
    runMediaCommand("next");
    runMediaCommand("previous");
    expect(player.calls).toEqual(["next", "previous"]);
  });

  it("reports when nothing here is loaded, so another window can take it", () => {
    expect(runMediaCommand("toggle")).toBe(false);
  });
});
