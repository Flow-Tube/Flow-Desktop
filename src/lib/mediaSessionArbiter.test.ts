import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimMediaSession,
  pauseAllMediaSessionClients,
  refreshMediaSession,
  registerMediaSessionClient,
  reportMediaPosition,
  setMediaSessionClaimListener,
  type MediaSessionClient,
} from "./mediaSessionArbiter";

// jsdom has no Media Session, so a stand-in records what the arbiter publishes.
const handlers = new Map<string, MediaSessionActionHandler | null>();
const session = {
  metadata: null as { title: string } | null,
  playbackState: "none" as MediaSessionPlaybackState,
  setActionHandler: (action: string, handler: MediaSessionActionHandler | null) => handlers.set(action, handler),
  setPositionState: vi.fn(),
};

class FakeMetadata {
  title: string;
  constructor(init: MediaMetadataInit) {
    this.title = init.title ?? "";
  }
}

const client = (title: string, playing = false) => {
  const state = { playing };
  const pause = vi.fn(() => {
    state.playing = false;
  });
  const play = vi.fn();
  const c: MediaSessionClient = {
    metadata: () => ({ title }),
    isPlaying: () => state.playing,
    position: () => ({ position: 30, duration: 200 }),
    actions: { play, pause },
    pause,
  };
  return { c, state, play, pause };
};

const unregisters: Array<() => void> = [];
const register = (...args: Parameters<typeof registerMediaSessionClient>) => {
  const unregister = registerMediaSessionClient(...args);
  unregisters.push(unregister);
  return unregister;
};

beforeEach(() => {
  Object.defineProperty(navigator, "mediaSession", { value: session, configurable: true });
  vi.stubGlobal("MediaMetadata", FakeMetadata);
});

afterEach(() => {
  while (unregisters.length) unregisters.pop()?.();
  handlers.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("media session arbiter", () => {
  it("tells other windows when a player here starts, and pauses everything when one there does", () => {
    const listener = vi.fn();
    setMediaSessionClaimListener(listener);
    const music = client("Song", true);
    const video = client("Video", true);
    register("music", music.c);
    register("video", video.c);

    claimMediaSession("video");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(music.pause).toHaveBeenCalled();

    pauseAllMediaSessionClients();
    expect(video.pause).toHaveBeenCalled();
    setMediaSessionClaimListener(null);
  });

  it("keeps music's keys when a paused video re-renders, and hands them over when the video leaves", () => {
    const music = client("Song", true);
    const video = client("Video");
    register("music", music.c);
    const unregisterVideo = register("video", video.c);
    refreshMediaSession("video");
    expect(session.metadata?.title).toBe("Song");

    unregisterVideo();
    expect(session.metadata?.title).toBe("Song");
    handlers.get("pause")?.({ action: "pause" });
    expect(music.pause).toHaveBeenCalled();
  });

  it("gives the keys to the player that starts, and pauses the other one", () => {
    const music = client("Song", true);
    const video = client("Video");
    register("music", music.c);
    register("video", video.c);

    video.state.playing = true;
    claimMediaSession("video");
    expect(music.pause).toHaveBeenCalledTimes(1);
    expect(session.metadata?.title).toBe("Video");
    expect(session.playbackState).toBe("playing");

    handlers.get("play")?.({ action: "play" });
    expect(video.play).toHaveBeenCalled();
    expect(music.play).not.toHaveBeenCalled();
  });

  it("publishes the position at most once a second", () => {
    vi.useFakeTimers();
    const music = client("Song", true);
    register("music", music.c);
    session.setPositionState.mockClear();
    vi.advanceTimersByTime(1_500);

    reportMediaPosition("music");
    reportMediaPosition("music");
    expect(session.setPositionState).toHaveBeenCalledTimes(1);
    expect(session.setPositionState).toHaveBeenLastCalledWith({ duration: 200, position: 30, playbackRate: 1 });
    reportMediaPosition("video");
    expect(session.setPositionState).toHaveBeenCalledTimes(1);
  });

  it("clears the controls when the last player goes away", () => {
    const unregister = register("music", client("Song").c);
    unregister();
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe("none");
    expect(handlers.get("play")).toBeNull();
  });
});
