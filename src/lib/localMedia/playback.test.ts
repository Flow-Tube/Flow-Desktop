import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalMediaFile } from "../api/localMedia";

vi.mock("../api/localMedia", () => ({
  getLocalStream: vi.fn(() => new Promise(() => {})),
  getLocalCover: vi.fn(() => Promise.resolve(null)),
}));

import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useRemoteControlStore } from "../../store/useRemoteControlStore";
import { playLocalFiles, stopPlayingLocalFile } from "./playback";
import { localFileToSong, localFileToVideo } from "./items";

const file = (id: string, kind: "video" | "audio"): LocalMediaFile => ({
  id,
  path: `/m/${id}`,
  folderPath: "/m/Folder",
  kind,
  title: id,
  fileName: id,
  artist: "",
  album: "",
  durationMs: 61_000,
  sizeBytes: 1,
  addedMs: 0,
  modifiedMs: 0,
  width: 0,
  height: 0,
  frameRate: null,
  bitrateKbps: null,
  videoCodec: "",
  audioCodec: "",
});

const [A, B] = ["local_0000000000000001", "local_0000000000000002"];

beforeEach(() => {
  usePlayerStore.getState().clearQueue();
  useMusicPlayerStore.setState({ queue: [], currentTrack: null, currentIndex: -1, isShuffle: false });
  useRemoteControlStore.setState({ target: null });
});

describe("playLocalFiles", () => {
  it("opens videos in the video player from the chosen one", () => {
    const navigate = vi.fn();
    playLocalFiles([file(A, "video"), file(B, "video")], 1, navigate);
    expect(usePlayerStore.getState().currentVideo?.id).toBe(B);
    expect(usePlayerStore.getState().queue.map((item) => item.id)).toEqual([A, B]);
    expect(navigate).toHaveBeenCalledWith(`/watch/${B}`);
  });

  it("plays songs in the music player and leaves the page where it is", () => {
    const navigate = vi.fn();
    playLocalFiles([file(A, "audio"), file(B, "audio")], 0, navigate);
    expect(useMusicPlayerStore.getState().currentTrack?.id).toBe(A);
    expect(usePlayerStore.getState().currentVideo).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("starts nothing while this computer controls another device", () => {
    useRemoteControlStore.setState({ target: "phone" });
    const navigate = vi.fn();
    playLocalFiles([file(A, "video")], 0, navigate);
    expect(usePlayerStore.getState().currentVideo).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("stopPlayingLocalFile", () => {
  it("moves on to the next video when one is queued", () => {
    usePlayerStore.getState().setQueue([localFileToVideo(file(A, "video")), localFileToVideo(file(B, "video"))], 0);
    const navigate = vi.fn();
    stopPlayingLocalFile(A, navigate);
    expect(usePlayerStore.getState().currentVideo?.id).toBe(B);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("leaves the watch page before closing the player on its only video", () => {
    usePlayerStore.getState().setQueue([localFileToVideo(file(A, "video"))], 0);
    const navigate = vi.fn();
    stopPlayingLocalFile(A, navigate);
    expect(navigate).toHaveBeenCalledWith("/local-media");
    expect(usePlayerStore.getState().currentVideo).toBeNull();
  });

  it("skips a song that is playing and drops one that is only queued", () => {
    const songs = [localFileToSong(file(A, "audio")), localFileToSong(file(B, "audio"))];
    useMusicPlayerStore.setState({ queue: songs, currentTrack: songs[0]!, currentIndex: 0 });
    stopPlayingLocalFile(A, vi.fn());
    expect(useMusicPlayerStore.getState().currentTrack?.id).toBe(B);
    expect(useMusicPlayerStore.getState().queue.map((song) => song.id)).toEqual([B]);
  });

  it("closes the music player on its only song", () => {
    const only = localFileToSong(file(A, "audio"));
    useMusicPlayerStore.setState({ queue: [only], currentTrack: only, currentIndex: 0 });
    stopPlayingLocalFile(A, vi.fn());
    expect(useMusicPlayerStore.getState().currentTrack).toBeNull();
  });
});
