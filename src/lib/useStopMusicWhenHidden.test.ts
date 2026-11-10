import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStopMusicWhenHidden } from "./useStopMusicWhenHidden";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import type { SongItem } from "../types/music";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const song = (videoId: string): SongItem => ({
  id: videoId, title: "Song", artists: [], album: null, duration: null, musicVideoType: null,
  thumbnail: null, explicit: false, videoId, playlistId: null, params: null,
});

let host: HTMLDivElement;
let root: Root;
const dismiss = vi.fn();

function Probe() {
  useStopMusicWhenHidden();
  return null;
}

function turnOff(track: SongItem) {
  useMusicPlayerStore.setState({ currentTrack: track, dismiss } as never);
  act(() => root.render(createElement(Probe)));
  act(() => useAppSettingsStore.setState({ values: { [SETTINGS.MUSIC_CONTENT_ENABLED]: "false" } }));
}

describe("useStopMusicWhenHidden", () => {
  beforeEach(() => {
    dismiss.mockClear();
    useAppSettingsStore.setState({ values: {} });
    host = document.createElement("div");
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    useAppSettingsStore.setState({ values: {} });
  });

  it("stops a YouTube Music song when Show Music goes off", () => {
    turnOff(song("dQw4w9WgXcQ"));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("lets a local file play on", () => {
    turnOff(song("local_0123456789abcdef"));
    expect(dismiss).not.toHaveBeenCalled();
  });
});
