// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSkipUnplayable } from "./useSkipUnplayable";
import { usePlayerStore } from "../store/usePlayerStore";
import { useUiStore } from "../store/useUiStore";

vi.mock("./streamResolution", async (original) => ({ ...(await original<object>()), prefetchStreamInfo: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const v = (id: string) => ({ id, title: id, channelName: "c" });
let root: Root;
function Probe({ error }: { error: string | null }) {
  const videoId = usePlayerStore((s) => s.currentVideo?.id ?? "");
  useSkipUnplayable(videoId, error);
  return null;
}
const render = (error: string | null) => act(() => root.render(createElement(Probe, { error })));
const currentId = () => usePlayerStore.getState().currentVideo?.id;

beforeEach(() => {
  usePlayerStore.getState().setQueue([v("a"), v("b"), v("c"), v("d"), v("e")], 0);
  vi.spyOn(useUiStore.getState(), "showToast").mockImplementation(() => {});
  root = createRoot(document.createElement("div"));
  render(null);
});
afterEach(() => act(() => root.unmount()));

describe("useSkipUnplayable", () => {
  it("leaves an error on a video the viewer picked", () => {
    render("refused");
    expect(currentId()).toBe("a");
  });

  it("moves past a video the queue reached, and stops after two in a row", () => {
    act(() => void usePlayerStore.getState().playNext());
    expect(currentId()).toBe("b");
    render(null);
    render("refused");
    expect(currentId()).toBe("c");
    render(null);
    render("refused");
    expect(currentId()).toBe("d");
    render(null);
    render("refused");
    expect(currentId()).toBe("d");
  });

  it("leaves an error on a queued video that had already started", () => {
    act(() => void usePlayerStore.getState().playNext());
    render(null);
    act(() => usePlayerStore.getState().markPlaybackStarted("b"));
    render("lost the network");
    expect(currentId()).toBe("b");
  });

  it("counts again once something has played", () => {
    act(() => void usePlayerStore.getState().playNext());
    render(null);
    render("refused");
    render(null);
    render("refused");
    expect(currentId()).toBe("d");
    render(null);
    act(() => usePlayerStore.getState().markPlaybackStarted("d"));
    act(() => void usePlayerStore.getState().playNext());
    render(null);
    render("refused");
    expect(currentId()).toBe("e");
  });

  it("stays put at the end of the queue", () => {
    usePlayerStore.getState().setQueue([v("x"), v("y")], 0);
    render(null);
    act(() => void usePlayerStore.getState().playNext());
    render(null);
    render("refused");
    expect(currentId()).toBe("y");
  });

  it("doesn't skip on the last video's error", () => {
    render("refused");
    act(() => void usePlayerStore.getState().playNext());
    expect(currentId()).toBe("b");
  });
});
