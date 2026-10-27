import { afterEach, describe, expect, it, vi } from "vitest";

import type { VideoSummary } from "../types/video";

vi.mock("../lib/streamResolution", () => ({
  prefetchStreamInfo: vi.fn(),
}));

import { usePlayerStore } from "./usePlayerStore";

const video = (id: string): VideoSummary => ({
  id,
  title: `Video ${id}`,
  channelName: "Flow",
});

afterEach(() => {
  usePlayerStore.getState().clearQueue();
  usePlayerStore.getState().setRepeatMode("none");
  usePlayerStore.getState().setAutoplayCandidates([]);
});

describe("video fullscreen", () => {
  it("resets fullscreen when the player is dismissed", () => {
    usePlayerStore.getState().setCurrentVideo(video("fullscreen"));
    usePlayerStore.getState().setIsVideoFullscreen(true);

    usePlayerStore.getState().dismissVideoPlayer();

    expect(usePlayerStore.getState().isVideoFullscreen).toBe(false);
  });
});

describe("enrichCurrentVideo", () => {
  it("keeps the same video object when the patch changes nothing", () => {
    usePlayerStore.getState().setQueue([{ id: "stub", title: "", channelName: "" }], 0);
    const before = usePlayerStore.getState().currentVideo;

    usePlayerStore.getState().enrichCurrentVideo("stub", { title: "", channelName: "" });

    expect(usePlayerStore.getState().currentVideo).toBe(before);
  });

  it("fills in the fields that arrived", () => {
    usePlayerStore.getState().setQueue([{ id: "stub", title: "", channelName: "" }], 0);

    usePlayerStore.getState().enrichCurrentVideo("stub", { title: "Me at the zoo" });

    expect(usePlayerStore.getState().currentVideo?.title).toBe("Me at the zoo");
    expect(usePlayerStore.getState().queue[0]?.title).toBe("Me at the zoo");
  });
});

describe("video queue", () => {
  it("keeps the current video when the first upcoming item is added", () => {
    const current = video("current");
    const next = video("next");
    usePlayerStore.getState().setCurrentVideo(current);

    expect(usePlayerStore.getState().addToQueue(next)).toBe("added");
    expect(usePlayerStore.getState().queue).toEqual([current, next]);
    expect(usePlayerStore.getState().currentIndex).toBe(0);
    expect(usePlayerStore.getState().addToQueue(next)).toBe("duplicate");
  });

  it("advances in order and wraps only when repeat queue is enabled", () => {
    const items = [video("one"), video("two")];
    usePlayerStore.getState().setQueue(items, 0);

    expect(usePlayerStore.getState().playNext()).toEqual(items[1]);
    expect(usePlayerStore.getState().playNext()).toBeNull();
    expect(usePlayerStore.getState().currentIndex).toBe(1);

    usePlayerStore.getState().setRepeatMode("all");
    expect(usePlayerStore.getState().playNext()).toEqual(items[0]);
    expect(usePlayerStore.getState().currentIndex).toBe(0);
  });

  it("appends a related candidate when autoplay reaches the end", () => {
    const current = video("current");
    const candidate = video("recommended");
    usePlayerStore.getState().setQueue([current], 0);
    usePlayerStore.getState().setAutoplayCandidates([candidate]);

    expect(usePlayerStore.getState().playNext(true)).toEqual(candidate);
    expect(usePlayerStore.getState().queue).toEqual([current, candidate]);
    expect(usePlayerStore.getState().currentIndex).toBe(1);
  });

  it("preserves the active item while reordering around it", () => {
    const items = [video("one"), video("two"), video("three")];
    usePlayerStore.getState().setQueue(items, 1);

    usePlayerStore.getState().moveQueueItem(0, 2);

    expect(usePlayerStore.getState().queue.map((item) => item.id)).toEqual(["two", "three", "one"]);
    expect(usePlayerStore.getState().currentVideo?.id).toBe("two");
    expect(usePlayerStore.getState().currentIndex).toBe(0);
  });
});

describe("pop-out mini player handoff", () => {
  it("stops rendering here once the pop-out window owns playback", () => {
    usePlayerStore.getState().setQueue([video("popped")], 0);

    usePlayerStore.getState().enterVideoWindowPip();

    expect(usePlayerStore.getState().videoPlayerMode).toBe("window");
    expect(usePlayerStore.getState().isVideoFullscreen).toBe(false);
  });

  it("hands playback back only to the video it belongs to", () => {
    usePlayerStore.getState().setQueue([video("handoff")], 0);
    usePlayerStore.getState().setPipHandoff("handoff", 128, true);

    expect(usePlayerStore.getState().consumePipHandoff("other")).toBeNull();
    expect(usePlayerStore.getState().consumePipHandoff("handoff")).toEqual({
      positionSeconds: 128,
      playing: true,
    });
    // Consumed once: a retry must not silently rewind to a stale position.
    expect(usePlayerStore.getState().consumePipHandoff("handoff")).toBeNull();
  });

  it("carries a paused handoff across even from the very start of a video", () => {
    usePlayerStore.getState().setPipHandoff("cold", 0, false);

    expect(usePlayerStore.getState().consumePipHandoff("cold")).toEqual({
      positionSeconds: 0,
      playing: false,
    });
  });

  it("mirrors a pop-out advance into a video this window never queued", () => {
    const first = video("first");
    usePlayerStore.getState().setQueue([first], 0);
    usePlayerStore.getState().enterVideoWindowPip();

    const autoplayed = video("autoplayed");
    usePlayerStore.getState().applyPipRemoteState({ video: autoplayed });

    expect(usePlayerStore.getState().queue.map((item) => item.id)).toEqual([
      "first",
      "autoplayed",
    ]);
    expect(usePlayerStore.getState().currentIndex).toBe(1);
    expect(usePlayerStore.getState().currentVideo?.id).toBe("autoplayed");
    // Mirroring must never take playback back from the pop-out.
    expect(usePlayerStore.getState().videoPlayerMode).toBe("window");
  });

  it("mirrors progress without disturbing the queue", () => {
    usePlayerStore.getState().setQueue([video("mirrored")], 0);
    usePlayerStore.getState().enterVideoWindowPip();

    usePlayerStore.getState().applyPipRemoteState({
      currentTime: 42,
      duration: 600,
      isPlaying: false,
    });

    expect(usePlayerStore.getState().currentTime).toBe(42);
    expect(usePlayerStore.getState().duration).toBe(600);
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(usePlayerStore.getState().currentIndex).toBe(0);
  });

  it("lifts the warm-up silence when playback is dismissed", () => {
    usePlayerStore.getState().setQueue([video("silent")], 0);
    usePlayerStore.getState().setHandoffSilent(true);

    usePlayerStore.getState().dismissVideoPlayer();

    // A stuck silent flag would leave the next video playing with no sound.
    expect(usePlayerStore.getState().isHandoffSilent).toBe(false);
  });

  it("clears the pending handoff when playback is dismissed", () => {
    usePlayerStore.getState().setQueue([video("dismissed")], 0);
    usePlayerStore.getState().setPipHandoff("dismissed", 90, true);

    usePlayerStore.getState().dismissVideoPlayer();

    expect(usePlayerStore.getState().pipHandoff).toBeNull();
    expect(usePlayerStore.getState().videoPlayerMode).toBe("watch");
  });
});

describe("shuffle", () => {
  const ids = () => usePlayerStore.getState().queue.map((item) => item.id);

  it("restores the original order when shuffle is turned off", () => {
    const items = [video("a"), video("b"), video("c"), video("d"), video("e")];
    usePlayerStore.getState().setQueue(items, 0);

    usePlayerStore.getState().toggleShuffle();
    expect(usePlayerStore.getState().isShuffle).toBe(true);
    expect(usePlayerStore.getState().unshuffledQueue).toEqual(items);
    // A random shuffle can land on the original order, so force a change.
    usePlayerStore.getState().moveQueueItem(4, 1);
    expect(ids()).not.toEqual(["a", "b", "c", "d", "e"]);

    usePlayerStore.getState().toggleShuffle();
    expect(usePlayerStore.getState().isShuffle).toBe(false);
    expect(usePlayerStore.getState().unshuffledQueue).toBeNull();
    expect(ids()).toEqual(["a", "b", "c", "d", "e"]);
    expect(usePlayerStore.getState().currentIndex).toBe(0);
  });

  it("drops items removed while shuffled and keeps the rest in original order", () => {
    const items = [video("a"), video("b"), video("c"), video("d")];
    usePlayerStore.getState().setQueue(items, 0);
    usePlayerStore.getState().toggleShuffle();

    // "c" is somewhere in the shuffled tail behind the current "a".
    const cIndex = usePlayerStore.getState().queue.findIndex((v) => v.id === "c");
    usePlayerStore.getState().removeFromQueue(cIndex);

    usePlayerStore.getState().toggleShuffle();
    expect(ids()).toEqual(["a", "b", "d"]);
  });

  it("appends items added while shuffled to the end on restore", () => {
    usePlayerStore.getState().setQueue([video("a"), video("b"), video("c")], 0);
    usePlayerStore.getState().toggleShuffle();

    usePlayerStore.getState().addToQueue(video("late"));

    usePlayerStore.getState().toggleShuffle();
    expect(ids()).toEqual(["a", "b", "c", "late"]);
  });

  it("treats a queue launched shuffled as restorable to its ordered form", () => {
    const ordered = [video("a"), video("b"), video("c")];
    const shuffled = [ordered[2]!, ordered[0]!, ordered[1]!];
    usePlayerStore.getState().setQueue(shuffled, 0, null, ordered);

    expect(usePlayerStore.getState().isShuffle).toBe(true);
    expect(usePlayerStore.getState().unshuffledQueue).toEqual(ordered);

    usePlayerStore.getState().toggleShuffle();
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(usePlayerStore.getState().currentVideo?.id).toBe("c");
    expect(usePlayerStore.getState().currentIndex).toBe(2);
  });

  it("clears shuffle state when a fresh queue is set", () => {
    usePlayerStore.getState().setQueue([video("a"), video("b")], 0);
    usePlayerStore.getState().toggleShuffle();
    expect(usePlayerStore.getState().isShuffle).toBe(true);

    usePlayerStore.getState().setQueue([video("x")], 0);
    expect(usePlayerStore.getState().isShuffle).toBe(false);
    expect(usePlayerStore.getState().unshuffledQueue).toBeNull();
  });

  it("keeps hand-added play-next items right after the current video in both directions", () => {
    const playlist = { id: "wl", title: "Watch Later", editable: true, reorderable: true };
    usePlayerStore
      .getState()
      .setQueue([video("w0"), video("w1"), video("w2"), video("w3")], 0, playlist);
    usePlayerStore.getState().addToQueue(video("x"));
    usePlayerStore.getState().addToQueue(video("y"));

    usePlayerStore.getState().toggleShuffle();
    expect(ids().slice(0, 3)).toEqual(["w0", "x", "y"]);
    expect([...ids().slice(3)].sort()).toEqual(["w1", "w2", "w3"]);

    usePlayerStore.getState().toggleShuffle();
    expect(ids()).toEqual(["w0", "x", "y", "w1", "w2", "w3"]);
  });

  it("pins an item hand-added while shuffled after the current video on restore", () => {
    const playlist = { id: "wl", title: "Watch Later", editable: true, reorderable: true };
    usePlayerStore.getState().setQueue([video("a"), video("b"), video("c")], 0, playlist);
    usePlayerStore.getState().toggleShuffle();
    usePlayerStore.getState().addToQueue(video("x"));

    usePlayerStore.getState().toggleShuffle();
    expect(ids()).toEqual(["a", "x", "b", "c"]);
  });

  it("keeps a video added while shuffled as the current one, with the unplayed ones after it", () => {
    const playlist = { id: "wl", title: "Watch Later", editable: true, reorderable: true };
    usePlayerStore.getState().setQueue([video("a"), video("b"), video("c"), video("d")], 0, playlist);
    usePlayerStore.getState().toggleShuffle();
    usePlayerStore.getState().addToQueue(video("x"));
    usePlayerStore.getState().playNext();
    expect(usePlayerStore.getState().currentVideo?.id).toBe("x");

    usePlayerStore.getState().toggleShuffle();
    expect(ids()).toEqual(["a", "x", "b", "c", "d"]);
    expect(usePlayerStore.getState().currentIndex).toBe(1);
  });
});

describe("set queue", () => {
  const ids = () => usePlayerStore.getState().queue.map((item) => item.id);

  it("drops duplicate ids and still starts on the requested video", () => {
    usePlayerStore.getState().setQueue([video("a"), video("b"), video("a"), video("c")], 3);
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(usePlayerStore.getState().currentIndex).toBe(2);
    expect(usePlayerStore.getState().currentVideo?.id).toBe("c");
  });
});

describe("autoplay", () => {
  it("drops the playlist context once autoplay extends the queue", () => {
    const playlist = { id: "wl", title: "Watch Later", editable: true, reorderable: true };
    usePlayerStore.getState().setQueue([video("a")], 0, playlist);
    usePlayerStore.getState().setAutoplayCandidates([video("auto")]);

    expect(usePlayerStore.getState().playNext(true)?.id).toBe("auto");
    expect(usePlayerStore.getState().playlistContext).toBeNull();
  });
});

describe("add to queue", () => {
  const ids = () => usePlayerStore.getState().queue.map((item) => item.id);
  const playlist = { id: "wl", title: "Watch Later", editable: true, reorderable: true };

  it("plays hand-added videos right after the current one, in add order", () => {
    usePlayerStore.getState().setQueue([video("w0"), video("w1"), video("w2")], 0, playlist);

    usePlayerStore.getState().addToQueue(video("x"));
    expect(ids()).toEqual(["w0", "x", "w1", "w2"]);

    usePlayerStore.getState().addToQueue(video("y"));
    expect(ids()).toEqual(["w0", "x", "y", "w1", "w2"]);

    const manual = usePlayerStore.getState().manualQueueIds;
    expect(manual.has("x")).toBe(true);
    expect(manual.has("y")).toBe(true);
    expect(manual.has("w1")).toBe(false);
  });

  it("starts playback in the mini player when nothing is playing", () => {
    expect(usePlayerStore.getState().currentVideo).toBeNull();

    usePlayerStore.getState().addToQueue(video("solo"));

    const state = usePlayerStore.getState();
    expect(state.currentVideo?.id).toBe("solo");
    expect(state.currentIndex).toBe(0);
    expect(state.isPlaying).toBe(true);
    expect(state.videoPlayerMode).toBe("pip");
    expect(ids()).toEqual(["solo"]);
  });

  it("starts a clean queue when nothing is playing after a playlist ran out", () => {
    usePlayerStore.getState().setQueue([video("w0")], 0, playlist);
    usePlayerStore.getState().toggleShuffle();
    usePlayerStore.getState().removeFromQueue(0);
    expect(usePlayerStore.getState().currentVideo).toBeNull();

    usePlayerStore.getState().addToQueue(video("solo"));

    const state = usePlayerStore.getState();
    expect(state.playlistContext).toBeNull();
    expect(state.isShuffle).toBe(false);
    expect(state.videoPlayerMode).toBe("pip");
  });

  it("closes the chapters panel when it opens the queue panel", () => {
    usePlayerStore.getState().setQueue([video("a"), video("b")], 0);
    usePlayerStore.getState().setIsChaptersPanelOpen(true);

    usePlayerStore.getState().addToQueue(video("c"));

    expect(usePlayerStore.getState().isQueuePanelOpen).toBe(true);
    expect(usePlayerStore.getState().isChaptersPanelOpen).toBe(false);
  });

  it("still appends to the end for a plain (non-playlist) queue", () => {
    usePlayerStore.getState().setQueue([video("a"), video("b")], 0);

    usePlayerStore.getState().addToQueue(video("c"));
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(usePlayerStore.getState().manualQueueIds.size).toBe(0);
  });

  it("forgets a hand-added video once it is removed", () => {
    usePlayerStore.getState().setQueue([video("w0"), video("w1")], 0, playlist);
    usePlayerStore.getState().addToQueue(video("x"));

    const index = usePlayerStore.getState().queue.findIndex((v) => v.id === "x");
    usePlayerStore.getState().removeFromQueue(index);

    expect(ids()).toEqual(["w0", "w1"]);
    expect(usePlayerStore.getState().manualQueueIds.has("x")).toBe(false);
  });
});

describe("restore queue item", () => {
  const ids = () => usePlayerStore.getState().queue.map((item) => item.id);

  it("puts a removed video back at its old place and keeps the current video", () => {
    usePlayerStore.getState().setQueue([video("a"), video("b"), video("c")], 1);
    usePlayerStore.getState().removeFromQueue(0);

    usePlayerStore.getState().restoreQueueItem(video("a"), 0);
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(usePlayerStore.getState().currentIndex).toBe(1);
    expect(usePlayerStore.getState().currentVideo?.id).toBe("b");
  });

  it("does not add a video that is already queued", () => {
    usePlayerStore.getState().setQueue([video("a"), video("b")], 0);

    usePlayerStore.getState().restoreQueueItem(video("b"), 0);
    expect(ids()).toEqual(["a", "b"]);
  });
});

describe("fullscreen side panel", () => {
  it("opens the matching sidebar panel too, so it is still open after fullscreen", () => {
    usePlayerStore.getState().setFullscreenPanel("queue");
    expect(usePlayerStore.getState()).toMatchObject({ fullscreenPanel: "queue", isQueuePanelOpen: true, isChaptersPanelOpen: false });

    usePlayerStore.getState().setFullscreenPanel("chapters");
    expect(usePlayerStore.getState()).toMatchObject({ fullscreenPanel: "chapters", isQueuePanelOpen: false, isChaptersPanelOpen: true });
  });

  it("closes when its panel is closed from inside it", () => {
    usePlayerStore.getState().setFullscreenPanel("chapters");
    usePlayerStore.getState().setIsChaptersPanelOpen(false);
    expect(usePlayerStore.getState().fullscreenPanel).toBeNull();
  });

  it("shows chat without touching the sidebar panels", () => {
    usePlayerStore.getState().setIsQueuePanelOpen(true);
    usePlayerStore.getState().setFullscreenPanel("chat");
    expect(usePlayerStore.getState()).toMatchObject({ fullscreenPanel: "chat", isQueuePanelOpen: true });
    usePlayerStore.getState().setFullscreenPanel(null);
    usePlayerStore.getState().setIsQueuePanelOpen(false);
  });
});
