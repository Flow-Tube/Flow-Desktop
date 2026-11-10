import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: "/" }),
  };
});

vi.mock("./FlowPlayerCore", () => ({
  FlowPlayerCore: () => createElement("div", { "data-testid": "flow-player-core" }),
}));

vi.mock("./FullscreenPanelHost", () => ({
  FullscreenPanelHost: () => null,
}));

vi.mock("../../lib/useMediaSessionMetadata", () => ({
  useMediaSessionMetadata: vi.fn(),
}));

import { usePlayerStore } from "../../store/usePlayerStore";
import { GlobalVideoPlayer } from "./GlobalVideoPlayer";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("GlobalVideoPlayer mini player buttons", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    usePlayerStore.setState({
      currentVideo: { id: "test-video", title: "Test Video", channelName: "Channel" },
      videoPlayerMode: "pip",
      isVideoFullscreen: false,
      isVideoFullscreenTransitioning: false,
      isTheaterMode: false,
      watchPageCache: null,
      isPlayerChromeShown: true,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  const buttons = () => host.querySelector('button[aria-label="Expand video"]')!.parentElement!;
  const grip = () => host.querySelector('[aria-hidden="true"]')!;

  it("fades with the player's controls", () => {
    act(() => root.render(createElement(GlobalVideoPlayer)));
    expect(buttons().className).toContain("opacity-100");
    expect(grip().className).toContain("opacity-100");

    act(() => usePlayerStore.setState({ isPlayerChromeShown: false }));
    expect(buttons().className).toContain("opacity-0");
    expect(buttons().className).toContain("pointer-events-none");
    expect(grip().className).toContain("opacity-0");
  });

  it("stays up while the pointer rests on the buttons", () => {
    act(() => root.render(createElement(GlobalVideoPlayer)));

    act(() => buttons().dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    act(() => usePlayerStore.setState({ isPlayerChromeShown: false }));
    expect(buttons().className).toContain("opacity-100");

    act(() => buttons().dispatchEvent(new PointerEvent("pointerout", { bubbles: true })));
    expect(buttons().className).toContain("opacity-0");
  });
});

describe("GlobalVideoPlayer beside the top bar", () => {
  let host: HTMLDivElement;
  let root: Root;
  let page: HTMLElement;
  let slotTop = 72;

  const rect = (top: number, height: number) =>
    ({ top, left: 0, width: 800, height, right: 800, bottom: top + height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    page = document.createElement("main");
    page.getBoundingClientRect = () => rect(56, 800);
    const slot = document.createElement("div");
    slot.dataset.flowWatchPlayerSlot = "true";
    slot.getBoundingClientRect = () => rect(slotTop, 450);
    page.append(slot);
    host = document.createElement("div");
    document.body.append(page, host);
    root = createRoot(host);
    usePlayerStore.setState({
      currentVideo: { id: "test-video", title: "Test Video", channelName: "Channel" },
      videoPlayerMode: "watch",
      isVideoFullscreen: false,
      isTheaterMode: false,
      watchPageCache: null,
      isPlayerBelowTopbar: false,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    page.remove();
    vi.unstubAllGlobals();
  });

  it("says when the docked player sits below the top bar", () => {
    slotTop = 72;
    act(() => root.render(createElement(GlobalVideoPlayer)));
    expect(usePlayerStore.getState().isPlayerBelowTopbar).toBe(true);

    act(() => root.unmount());
    expect(usePlayerStore.getState().isPlayerBelowTopbar).toBe(false);
    root = createRoot(host);
  });

  it("reports the player under the bar once the page scrolls it there", () => {
    slotTop = 40;
    act(() => root.render(createElement(GlobalVideoPlayer)));
    expect(usePlayerStore.getState().isPlayerBelowTopbar).toBe(false);
  });
});
