import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "../store/usePlayerStore";
import type { VideoSummary } from "../types/video";

const details = vi.hoisted(() => vi.fn());
vi.mock("./api/youtube", () => ({ getPlaylistDetails: details }));
vi.mock("./streamResolution", () => ({ prefetchStreamInfo: vi.fn() }));

import { playLinkedPlaylist } from "./linkedPlaylist";

const video = (id: string) => ({ id, title: id, channelName: "C" }) as VideoSummary;
const ids = () => usePlayerStore.getState().queue.map((item) => item.id);

describe("playLinkedPlaylist", () => {
  beforeEach(() => {
    details.mockReset();
    usePlayerStore.setState({ queue: [video("b")], currentIndex: 0, currentVideo: video("b"), playlistContext: null });
  });

  it("makes the list the queue around the linked video", async () => {
    details.mockResolvedValue({ id: "PL", title: "List", videos: [video("a"), video("b"), video("c")], nextPageToken: null });
    await playLinkedPlaylist("PL", "b");
    expect(ids()).toEqual(["a", "b", "c"]);
    const state = usePlayerStore.getState();
    expect(state.currentIndex).toBe(1);
    expect(state.currentVideo?.id).toBe("b");
    expect(state.playlistContext).toMatchObject({ id: "PL", title: "List", editable: false });
  });

  it("adds later pages to the queue", async () => {
    details.mockResolvedValueOnce({ id: "PL", title: "List", videos: [video("b")], nextPageToken: "next" });
    details.mockResolvedValueOnce({ id: "PL", title: "", videos: [video("c"), video("d")], nextPageToken: null });
    await playLinkedPlaylist("PL", "b");
    expect(ids()).toEqual(["b", "c", "d"]);
  });

  it("keeps the linked video when it isn't on the first page", async () => {
    details.mockResolvedValue({ id: "PL", title: "List", videos: [video("a")], nextPageToken: null });
    await playLinkedPlaylist("PL", "b");
    expect(ids()).toEqual(["b", "a"]);
    expect(usePlayerStore.getState().currentVideo?.id).toBe("b");
  });

  it("plays the video alone when the list can't be read", async () => {
    details.mockRejectedValue(new Error("private"));
    await playLinkedPlaylist("PL", "b");
    expect(ids()).toEqual(["b"]);
    expect(usePlayerStore.getState().playlistContext).toBeNull();
  });

  it("leaves a queue the user started meanwhile alone", async () => {
    details.mockImplementation(async () => {
      usePlayerStore.getState().setQueue([video("z")], 0);
      return { id: "PL", title: "List", videos: [video("b")], nextPageToken: null };
    });
    await playLinkedPlaylist("PL", "b");
    expect(ids()).toEqual(["z"]);
  });
});
