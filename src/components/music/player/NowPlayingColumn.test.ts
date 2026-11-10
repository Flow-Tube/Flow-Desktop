import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SongItem } from "../../../types/music";
import { useLikesStore } from "../../../store/useLikesStore";
import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import { NowPlayingColumn } from "./NowPlayingColumn";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("../../../lib/useElementSize", () => ({
  useElementSize: () => ({ width: 600, height: 800 }),
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

const sampleTrack: SongItem = {
  id: "sitara-1",
  title: "Sitara",
  artists: [
    { name: "DIVINE", id: "UC-divine" },
    { name: "Jonita Gandhi", id: "UC-jonita" },
    { name: "Guest Feature", id: null },
  ],
  album: { id: "album-1", name: "Gunehgar" },
  duration: 180,
  musicVideoType: null,
  thumbnail: "https://example.com/thumb.jpg",
  explicit: false,
  videoId: "sitara-1",
  playlistId: null,
  params: null,
};

describe("NowPlayingColumn multi-artist navigation", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    mockNavigate.mockClear();

    useLikesStore.setState({ items: [], loaded: true, load: vi.fn() });
    useMusicPlayerStore.setState({
      isBuffering: false,
      loadingStreamId: null,
      closeOverlay: vi.fn(),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("renders distinct buttons for artists with IDs and plain text for artists without IDs", () => {
    act(() => {
      root.render(createElement(NowPlayingColumn, { track: sampleTrack, compact: false, artworkHidden: false, onOpenEqualizer: vi.fn() }));
    });

    const artistButtons = host.querySelectorAll<HTMLButtonElement>("h1 + span button");
    expect(artistButtons).toHaveLength(2);
    expect(artistButtons[0]?.textContent).toBe("DIVINE");
    expect(artistButtons[1]?.textContent).toBe("Jonita Gandhi");

    const artistSpans = host.querySelectorAll<HTMLSpanElement>("h1 + span span");
    const spanTexts = Array.from(artistSpans).map((s) => s.textContent);
    expect(spanTexts).toContain("Guest Feature");
  });

  it("navigates to the secondary artist when the secondary artist button is clicked", () => {
    const closeOverlay = vi.fn();
    useMusicPlayerStore.setState({ closeOverlay });

    act(() => {
      root.render(createElement(NowPlayingColumn, { track: sampleTrack, compact: false, artworkHidden: false, onOpenEqualizer: vi.fn() }));
    });

    const artistButtons = host.querySelectorAll<HTMLButtonElement>("h1 + span button");
    const jonitaButton = artistButtons[1];
    expect(jonitaButton?.textContent).toBe("Jonita Gandhi");

    act(() => {
      jonitaButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(closeOverlay).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/music/artist/UC-jonita");
  });

  it("navigates to the primary artist when the primary artist button is clicked", () => {
    const closeOverlay = vi.fn();
    useMusicPlayerStore.setState({ closeOverlay });

    act(() => {
      root.render(createElement(NowPlayingColumn, { track: sampleTrack, compact: false, artworkHidden: false, onOpenEqualizer: vi.fn() }));
    });

    const artistButtons = host.querySelectorAll<HTMLButtonElement>("h1 + span button");
    const divineButton = artistButtons[0];
    expect(divineButton?.textContent).toBe("DIVINE");

    act(() => {
      divineButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(closeOverlay).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/music/artist/UC-divine");
  });
});
