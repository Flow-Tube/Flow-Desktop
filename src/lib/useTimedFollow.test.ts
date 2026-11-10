// @vitest-environment jsdom
import { createElement, act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTimedFollow } from "./useTimedFollow";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Comment } from "../types/video";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const timed = (id: string, seconds: number): Comment => ({
  id,
  author: "a",
  text: "t",
  richText: { text: "t", spans: [{ start: 0, length: 1, target: { kind: "timestamp", seconds } }], emojis: [] },
});
const comments = [timed("late", 90), timed("early", 10)];

let hook: ReturnType<typeof useTimedFollow>;
let root: Root;
const scrollTo = vi.fn();

function Probe({ enabled }: { enabled: boolean }) {
  const listRef = useRef<HTMLDivElement>(null);
  hook = useTimedFollow(listRef, comments, enabled);
  return createElement(
    "div",
    { ref: (el: HTMLDivElement | null) => { listRef.current = el; if (el) el.scrollTo = scrollTo; } },
    comments.map((c) => createElement("div", { key: c.id, "data-comment-id": c.id })),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  scrollTo.mockReset();
  usePlayerStore.setState({ currentTime: 0 });
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("useTimedFollow", () => {
  it("does nothing while off", () => {
    act(() => root.render(createElement(Probe, { enabled: false })));
    act(() => usePlayerStore.setState({ currentTime: 95 }));
    expect(hook.anchorId).toBeUndefined();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls only when a timestamp is crossed", () => {
    act(() => root.render(createElement(Probe, { enabled: true })));
    expect(hook.anchorId).toBeUndefined();
    expect(scrollTo).toHaveBeenCalledTimes(1);
    act(() => usePlayerStore.setState({ currentTime: 11 }));
    expect(hook.anchorId).toBe("early");
    // "early" was already where the list rested, so nothing moved.
    expect(scrollTo).toHaveBeenCalledTimes(1);
    act(() => usePlayerStore.setState({ currentTime: 12 }));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    act(() => usePlayerStore.setState({ currentTime: 91 }));
    expect(hook.anchorId).toBe("late");
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("holds still while someone reads, then follows again", () => {
    act(() => root.render(createElement(Probe, { enabled: true })));
    scrollTo.mockClear();
    act(() => hook.pauseForReading());
    act(() => usePlayerStore.setState({ currentTime: 91 }));
    expect(hook.anchorId).toBe("late");
    expect(scrollTo).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(6000));
    act(() => usePlayerStore.setState({ currentTime: 11 }));
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});
