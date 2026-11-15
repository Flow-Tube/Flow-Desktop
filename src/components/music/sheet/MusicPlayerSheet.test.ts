import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../../store/useDownloadsLibraryStore", () => ({
  useDownloadsLibraryStore: (selector: (state: unknown) => unknown) =>
    selector({
      load: vi.fn(),
      ensureLoaded: vi.fn(),
      records: [],
      downloadedIds: new Set<string>(),
      loaded: true,
      loading: false,
    }),
}));

const mockRemoteActive = vi.fn<() => string | null>(() => null);
const mockControlledDevice = vi.fn<() => unknown>(() => null);

vi.mock("../../../lib/live/usePlayOn", () => ({
  useRemoteActive: () => mockRemoteActive(),
  useControlledDevice: () => mockControlledDevice(),
  usePlayOnAvailable: () => false,
}));

import type { SongItem } from "../../../types/music";
import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import { useAppSettingsStore } from "../../../store/useAppSettingsStore";
import { SETTINGS } from "../../../lib/settings/schema";
import { MusicPlayerSheet } from "./MusicPlayerSheet";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sampleTrack: SongItem = {
  id: "track-1",
  title: "Test Track Title",
  artists: [{ name: "Test Artist", id: "artist-1" }],
  album: null,
  duration: 180,
  musicVideoType: "MUSIC_VIDEO_TYPE_ATV",
  thumbnail: "https://example.com/art.jpg",
  explicit: false,
  videoId: "track-1",
  playlistId: null,
  params: null,
};

let host: HTMLDivElement;
let root: Root;

describe("MusicPlayerSheet background click expansion", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    mockRemoteActive.mockReturnValue(null);
    mockControlledDevice.mockReturnValue(null);

    useMusicPlayerStore.setState({
      currentTrack: sampleTrack,
      viewState: "dock",
      isPlaying: false,
      isBuffering: false,
      loadingStreamId: null,
      volume: 1,
      isMuted: false,
      openOverlay: vi.fn(),
      togglePlay: vi.fn(),
      next: vi.fn(),
      previous: vi.fn(),
      toggleShuffle: vi.fn(),
      cycleRepeat: vi.fn(),
      dismiss: vi.fn(),
    });
  });

  const setLook = (values: Record<string, string>) =>
    useAppSettingsStore.setState((state) => ({ values: { ...state.values, ...values } }));

  afterEach(() => {
    setLook({ [SETTINGS.MUSIC_MINI_PLAYER_STYLE]: "pill", [SETTINGS.MINI_BAR_BUTTONS]: "" });
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("expands full player when clicking mini-player pill background", () => {
    const openOverlay = vi.fn();
    useMusicPlayerStore.setState({ openOverlay });

    act(() => {
      root.render(createElement(MusicPlayerSheet));
    });

    const pill = host.querySelector<HTMLDivElement>("[data-music-dock-bar]");
    expect(pill).not.toBeNull();
    expect(pill?.className).toContain("cursor-pointer");

    // Click directly on the pill background
    act(() => {
      pill?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(openOverlay).toHaveBeenCalledTimes(1);
    expect(openOverlay).toHaveBeenCalledWith("full");
  });

  it("continues to expand full player when clicking artwork or track title button", () => {
    const openOverlay = vi.fn();
    useMusicPlayerStore.setState({ openOverlay });

    act(() => {
      root.render(createElement(MusicPlayerSheet));
    });

    const expandButton = host.querySelector<HTMLButtonElement>('button[aria-label="Expand"]');
    expect(expandButton).not.toBeNull();

    act(() => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(openOverlay).toHaveBeenCalledTimes(1);
    expect(openOverlay).toHaveBeenCalledWith("full");
  });

  it("does not expand full player via background handler when clicking transport buttons", () => {
    const openOverlay = vi.fn();
    const togglePlay = vi.fn();
    useMusicPlayerStore.setState({ openOverlay, togglePlay });

    act(() => {
      root.render(createElement(MusicPlayerSheet));
    });

    const playButton = host.querySelector<HTMLButtonElement>('button[aria-label="Play"]');
    expect(playButton).not.toBeNull();

    act(() => {
      playButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // The button action was invoked, but background openOverlay was not called from the pill
    expect(openOverlay).not.toHaveBeenCalled();
  });

  it("does not expand full player via background handler when clicking the Classic scrubber", () => {
    const openOverlay = vi.fn();
    useMusicPlayerStore.setState({ openOverlay });
    setLook({ [SETTINGS.MUSIC_MINI_PLAYER_STYLE]: "classic" });

    act(() => {
      root.render(createElement(MusicPlayerSheet));
    });

    const scrubber = host.querySelector<HTMLElement>('[data-sheet-drag-ignore]');
    expect(scrubber).not.toBeNull();

    act(() => {
      scrubber?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(openOverlay).not.toHaveBeenCalled();
  });

  it("shows the Pill's chosen buttons in their order", () => {
    setLook({ [SETTINGS.MINI_BAR_BUTTONS]: "next,play_pause,queue,close" });
    act(() => {
      root.render(createElement(MusicPlayerSheet));
    });

    const labels = [...host.querySelectorAll<HTMLButtonElement>('[data-music-dock-bar] [dir="ltr"] button')].map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Next", "Play", "Queue", "Close player"]);
    // Close is in the bar, so the corner's dismiss button stays away.
    expect(host.querySelectorAll('button[aria-label="Close player"]').length).toBe(1);
  });

  it("keeps the Classic bar's fixed transport and actions", () => {
    setLook({ [SETTINGS.MUSIC_MINI_PLAYER_STYLE]: "classic", [SETTINGS.MINI_BAR_BUTTONS]: "next" });
    act(() => {
      root.render(createElement(MusicPlayerSheet));
    });

    for (const label of ["Shuffle", "Previous", "Play", "Next", "Repeat", "Volume", "Queue", "Lyrics", "Equalizer"]) {
      expect(host.querySelector(`button[aria-label="${label}"]`), label).not.toBeNull();
    }
  });

  const pressAndRelease = (pill: HTMLElement, dx: number, dy: number) => {
    act(() => {
      const at = { bubbles: true, pointerId: 1, button: 0 };
      pill.dispatchEvent(new PointerEvent("pointerdown", { ...at, clientX: 100, clientY: 100 }));
      pill.dispatchEvent(new PointerEvent("pointermove", { ...at, clientX: 100 + dx, clientY: 100 + dy }));
      pill.dispatchEvent(new PointerEvent("pointerup", { ...at, clientX: 100 + dx, clientY: 100 + dy }));
      pill.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  };

  it("still expands when the press moved only a little", () => {
    const openOverlay = vi.fn();
    useMusicPlayerStore.setState({ openOverlay });
    act(() => {
      root.render(createElement(MusicPlayerSheet));
    });

    pressAndRelease(host.querySelector<HTMLDivElement>("[data-music-dock-bar]")!, 3, 2);

    expect(openOverlay).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["sideways", 30, 0],
    ["down", 0, 30],
  ])("does not expand after a drag %s", (_direction, dx, dy) => {
    const openOverlay = vi.fn();
    useMusicPlayerStore.setState({ openOverlay });
    act(() => {
      root.render(createElement(MusicPlayerSheet));
    });

    pressAndRelease(host.querySelector<HTMLDivElement>("[data-music-dock-bar]")!, dx, dy);

    expect(openOverlay).not.toHaveBeenCalled();
  });

  it("does not expand full player and has no cursor-pointer when remote playback (away) is active", () => {
    mockRemoteActive.mockReturnValue("remote-device-1");
    mockControlledDevice.mockReturnValue({
      did: "remote-device-1",
      name: "Pixel 9",
      kind: "phone",
      now: {
        video: "v1",
        title: "Remote Song",
        by: "Remote Artist",
        state: "playing",
        music: true,
        dur: 200,
        pos: 10,
        posAt: Date.now(),
      },
    });

    const openOverlay = vi.fn();
    useMusicPlayerStore.setState({ openOverlay });

    act(() => {
      root.render(createElement(MusicPlayerSheet));
    });

    const pill = host.querySelector<HTMLDivElement>("[data-music-dock-bar]");
    expect(pill).not.toBeNull();
    expect(pill?.className).not.toContain("cursor-pointer");

    act(() => {
      pill?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(openOverlay).not.toHaveBeenCalled();
  });
});
