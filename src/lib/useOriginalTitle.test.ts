import { act, createElement, useRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getOriginalTitle = vi.fn();
vi.mock("./api/youtube", () => ({
  getOriginalTitle: (videoId: string) => getOriginalTitle(videoId),
}));

const { knownOriginalTitle, loadOriginalTitle, useOriginalTitle } = await import("./useOriginalTitle");

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

// The module cache lives for the session by design, so each test uses its own id.
let nextId = 0;
const freshId = () => `ttl${String(nextId++).padStart(8, "0")}`;

class FakeObserver {
  static instances: FakeObserver[] = [];
  targets = new Set<Element>();
  options: IntersectionObserverInit | undefined;
  constructor(private callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.options = options;
    FakeObserver.instances.push(this);
  }
  observe(target: Element) { this.targets.add(target); }
  unobserve(target: Element) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
  report(target: Element, isIntersecting: boolean) {
    this.callback([{ target, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

function setEnabled(enabled: boolean) {
  useAppSettingsStore.setState({
    values: { ...useAppSettingsStore.getState().values, [SETTINGS.ORIGINAL_TITLES]: String(enabled) },
  });
}

describe("useOriginalTitle", () => {
  let host: HTMLDivElement;
  let root: Root;
  let shown: string | null;

  function Card({ id, gated }: { id: string; gated: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    shown = useOriginalTitle(id, gated ? (ref as RefObject<Element | null>) : undefined);
    return createElement("div", { ref, "data-card": id });
  }

  const render = (id: string, gated = true) => act(() => root.render(createElement(Card, { id, gated })));
  const card = () => host.querySelector("[data-card]")!;
  const observer = () => FakeObserver.instances[FakeObserver.instances.length - 1]!;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    FakeObserver.instances = [];
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    getOriginalTitle.mockResolvedValue("Título original");
    setEnabled(true);
    shown = null;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setEnabled(false);
  });

  it("asks for nothing and watches nothing while switched off", async () => {
    setEnabled(false);
    render(freshId());
    await flush();

    expect(getOriginalTitle).not.toHaveBeenCalled();
    expect(FakeObserver.instances).toHaveLength(0);
    expect(shown).toBeNull();
  });

  it("never asks for a card that stays off screen", async () => {
    render(freshId());
    await flush();
    act(() => observer().report(card(), false));
    act(() => { vi.advanceTimersByTime(5_000); });
    await flush();

    expect(getOriginalTitle).not.toHaveBeenCalled();
    expect(shown).toBeNull();
  });

  it("asks once a card has stayed near the screen, then shows the answer", async () => {
    const id = freshId();
    render(id);
    act(() => observer().report(card(), true));
    act(() => { vi.advanceTimersByTime(200); });
    await flush();

    expect(getOriginalTitle).toHaveBeenCalledExactlyOnceWith(id);
    expect(shown).toBe("Título original");
  });

  it("skips a card a fast scroll passes straight through", async () => {
    render(freshId());
    act(() => observer().report(card(), true));
    act(() => { vi.advanceTimersByTime(50); });
    act(() => observer().report(card(), false));
    act(() => { vi.advanceTimersByTime(5_000); });
    await flush();

    expect(getOriginalTitle).not.toHaveBeenCalled();
  });

  it("watches a grid card by its wrapper, which keeps its layout when skipped", async () => {
    const wrapper = document.createElement("div");
    wrapper.className = "flow-grid-card";
    host.append(wrapper);
    const wrappedRoot = createRoot(wrapper);
    await act(async () => wrappedRoot.render(createElement(Card, { id: freshId(), gated: true })));

    expect([...observer().targets]).toEqual([wrapper]);
    act(() => wrappedRoot.unmount());
  });

  it("shares one observer across cards", async () => {
    const other = document.createElement("div");
    document.body.append(other);
    const otherRoot = createRoot(other);
    render(freshId());
    await act(async () => otherRoot.render(createElement(Card, { id: freshId(), gated: true })));

    expect(FakeObserver.instances).toHaveLength(1);
    expect(observer().targets.size).toBe(2);
    act(() => otherRoot.unmount());
    other.remove();
  });

  it("shows a title already known on the first render, with no observer", async () => {
    const id = freshId();
    await loadOriginalTitle(id);
    getOriginalTitle.mockClear();

    render(id);

    expect(shown).toBe("Título original");
    expect(FakeObserver.instances).toHaveLength(0);
    expect(getOriginalTitle).not.toHaveBeenCalled();
  });

  it("asks at once when the caller is already on screen", async () => {
    const id = freshId();
    render(id, false);
    await flush();

    expect(getOriginalTitle).toHaveBeenCalledExactlyOnceWith(id);
    expect(shown).toBe("Título original");
  });

  it("does not ask for an id that is not a video", async () => {
    render("too-short", false);
    await flush();

    expect(getOriginalTitle).not.toHaveBeenCalled();
  });

  it("drops back to the listed title when the switch is turned off", async () => {
    const id = freshId();
    render(id, false);
    await flush();
    expect(shown).toBe("Título original");

    act(() => setEnabled(false));

    expect(shown).toBeNull();
  });

  // The backend's null can mean a rate limit or no network, so it must not stick here.
  it("asks again after no answer, and keeps a title it got", async () => {
    const id = freshId();
    getOriginalTitle.mockResolvedValueOnce(null);
    expect(await loadOriginalTitle(id)).toBeNull();
    expect(knownOriginalTitle(id)).toBeNull();

    expect(await loadOriginalTitle(id)).toBe("Título original");
    expect(await loadOriginalTitle(id)).toBe("Título original");
    expect(getOriginalTitle).toHaveBeenCalledTimes(2);
  });

  it("does not stick to a failure either", async () => {
    const id = freshId();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    getOriginalTitle.mockRejectedValueOnce(new Error("backend panic"));

    expect(await loadOriginalTitle(id)).toBeNull();
    expect(await loadOriginalTitle(id)).toBe("Título original");
    warn.mockRestore();
  });
});
