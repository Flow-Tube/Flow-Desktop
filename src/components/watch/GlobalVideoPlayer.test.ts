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
import { PLAYER_CHROME_HIDE_DELAY_MS } from "../../lib/playerChrome";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("GlobalVideoPlayer mini-player idle dismissal", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    usePlayerStore.setState({
      currentVideo: { id: "test-video", title: "Test Video" } as any,
      videoPlayerMode: "pip",
      isVideoFullscreen: false,
      isVideoFullscreenTransitioning: false,
      isTheaterMode: false,
      watchPageCache: null,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("shows controls on pointer move and hides them after 2.4s idle timeout", () => {
    act(() => {
      root.render(createElement(GlobalVideoPlayer));
    });

    const expandBtn = host.querySelector('button[aria-label="Expand video"]');
    expect(expandBtn).not.toBeNull();
    const controlsContainer = expandBtn!.parentElement!;

    // Initially hidden
    expect(controlsContainer.className).toContain("opacity-0");
    expect(controlsContainer.className).toContain("pointer-events-none");

    const playerFrame = controlsContainer.parentElement!;

    // Pointer movement reveals controls
    act(() => {
      playerFrame.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    });

    expect(controlsContainer.className).toContain("opacity-100");
    expect(controlsContainer.className).toContain("pointer-events-auto");

    // Advance 2399ms: still visible
    act(() => {
      vi.advanceTimersByTime(PLAYER_CHROME_HIDE_DELAY_MS - 1);
    });
    expect(controlsContainer.className).toContain("opacity-100");

    // Advance past 2400ms: auto-hides due to inactivity
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(controlsContainer.className).toContain("opacity-0");
    expect(controlsContainer.className).toContain("pointer-events-none");
  });

  it("hides controls immediately when pointer leaves the floating player", () => {
    act(() => {
      root.render(createElement(GlobalVideoPlayer));
    });

    const expandBtn = host.querySelector('button[aria-label="Expand video"]')!;
    const controlsContainer = expandBtn.parentElement!;
    const playerFrame = controlsContainer.parentElement!;

    act(() => {
      playerFrame.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    });
    expect(controlsContainer.className).toContain("opacity-100");

    act(() => {
      playerFrame.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
    });
    expect(controlsContainer.className).toContain("opacity-0");
  });

  it("pauses idle dismissal while pointer rests directly on action buttons", () => {
    act(() => {
      root.render(createElement(GlobalVideoPlayer));
    });

    const expandBtn = host.querySelector('button[aria-label="Expand video"]')!;
    const controlsContainer = expandBtn.parentElement!;
    const playerFrame = controlsContainer.parentElement!;

    act(() => {
      playerFrame.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    });

    // Pointer enters buttons pill
    act(() => {
      controlsContainer.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });

    // Advance past 2.4s: still visible because hovering over buttons pauses timer
    act(() => {
      vi.advanceTimersByTime(PLAYER_CHROME_HIDE_DELAY_MS + 1000);
    });
    expect(controlsContainer.className).toContain("opacity-100");

    // Pointer leaves buttons pill
    act(() => {
      controlsContainer.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
    });

    // 2.4s timer resumed
    act(() => {
      vi.advanceTimersByTime(PLAYER_CHROME_HIDE_DELAY_MS);
    });
    expect(controlsContainer.className).toContain("opacity-0");
  });
});
