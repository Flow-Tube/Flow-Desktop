import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SETTINGS } from "../../lib/settings/schema";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import type { VideoSummary } from "../../types/video";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getOriginalTitle = vi.fn();
const getDeArrowOverride = vi.fn();
vi.mock("../../lib/api/youtube", async (original) => ({
  ...(await original<typeof import("../../lib/api/youtube")>()),
  getOriginalTitle: (videoId: string) => getOriginalTitle(videoId),
}));
vi.mock("../../lib/api/foss", async (original) => ({
  ...(await original<typeof import("../../lib/api/foss")>()),
  getDeArrowOverride: (videoId: string) => getDeArrowOverride(videoId),
}));

const { VideoCard } = await import("./VideoCard");

const LISTED = "Wednesday news in 10 minutes";
const ORIGINAL = "Las noticias del miércoles en 10 minutos";
const DEARROW = "Wednesday's news, summarised";

const flush = () => act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); });

// The title caches live for the session by design, so each test uses its own id.
let nextId = 0;
const freshId = () => `vcd${String(nextId++).padStart(8, "0")}`;

class FakeObserver {
  static instances: FakeObserver[] = [];
  targets = new Set<Element>();
  private callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeObserver.instances.push(this);
  }
  observe(target: Element) { this.targets.add(target); }
  unobserve(target: Element) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
  reportAll(isIntersecting: boolean) {
    for (const target of this.targets) {
      this.callback([{ target, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
  }
}

function setOriginalTitles(enabled: boolean) {
  useAppSettingsStore.setState({
    values: { ...useAppSettingsStore.getState().values, [SETTINGS.ORIGINAL_TITLES]: String(enabled) },
  });
}

describe("VideoCard title", () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = (id: string) =>
    act(() =>
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(VideoCard, {
            video: { id, title: LISTED, channelName: "RTVE" } as VideoSummary,
            onPlay: vi.fn(),
          }),
        ),
      ),
    );
  const comesNearScreen = async () => {
    const observer = FakeObserver.instances.find((instance) => instance.targets.size > 0)!;
    act(() => observer.reportAll(true));
    act(() => { vi.advanceTimersByTime(200); });
    await flush();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    FakeObserver.instances = [];
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    getOriginalTitle.mockResolvedValue(ORIGINAL);
    getDeArrowOverride.mockResolvedValue(null);
    useSettingsStore.setState({ dearrowEnabled: true });
    setOriginalTitles(true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setOriginalTitles(false);
  });

  it("shows the listed title and asks for nothing while switched off", async () => {
    setOriginalTitles(false);
    render(freshId());
    await flush();

    expect(host.textContent).toContain(LISTED);
    expect(getOriginalTitle).not.toHaveBeenCalled();
    expect(FakeObserver.instances.some((instance) => instance.targets.size > 0)).toBe(false);
  });

  it("keeps the listed title and asks for nothing while off screen", async () => {
    render(freshId());
    await flush();

    expect(host.textContent).toContain(LISTED);
    expect(getOriginalTitle).not.toHaveBeenCalled();
  });

  it("shows the original title once near the screen", async () => {
    const id = freshId();
    render(id);
    await flush();
    await comesNearScreen();

    expect(getOriginalTitle).toHaveBeenCalledExactlyOnceWith(id);
    expect(host.textContent).toContain(ORIGINAL);
    expect(host.textContent).not.toContain(LISTED);
  });

  it("keeps the listed title when there is no original to be had", async () => {
    getOriginalTitle.mockResolvedValue(null);
    render(freshId());
    await flush();
    await comesNearScreen();

    expect(host.textContent).toContain(LISTED);
  });

  it("shows a DeArrow title ahead of the original, without asking for the original", async () => {
    getDeArrowOverride.mockResolvedValue({ title: DEARROW, thumbnailUrl: null });
    render(freshId());
    await flush();

    expect(host.textContent).toContain(DEARROW);
    expect(host.textContent).not.toContain(ORIGINAL);
    expect(getOriginalTitle).not.toHaveBeenCalled();
  });

  it("shows the original when DeArrow is on but has no title for the video", async () => {
    render(freshId());
    await flush();
    await comesNearScreen();

    expect(host.textContent).toContain(ORIGINAL);
  });
});
