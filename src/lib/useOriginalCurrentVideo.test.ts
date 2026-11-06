import { act, createElement, Fragment, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { usePlayerStore } from "../store/usePlayerStore";
import type { VideoDetails, VideoSummary } from "../types/video";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getOriginalTitle = vi.fn();
vi.mock("./api/youtube", async (original) => ({
  ...(await original<typeof import("./api/youtube")>()),
  getOriginalTitle: (videoId: string) => getOriginalTitle(videoId),
}));

const { useOriginalCurrentVideo } = await import("./useOriginalCurrentVideo");
const { loadOriginalTitle } = await import("./useOriginalTitle");

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

// The title cache lives for the session by design, so each test uses its own id.
let nextId = 0;
const freshId = () => `cur${String(nextId++).padStart(8, "0")}`;

const playing = (id: string, title = "Translated title"): VideoSummary =>
  ({ id, title, channelName: "RTVE" }) as VideoSummary;

function setEnabled(enabled: boolean) {
  useAppSettingsStore.setState({
    values: { ...useAppSettingsStore.getState().values, [SETTINGS.ORIGINAL_TITLES]: String(enabled) },
  });
}

describe("useOriginalCurrentVideo", () => {
  let host: HTMLDivElement;
  let root: Root;

  function Player({ details }: { details: VideoDetails | null }) {
    useOriginalCurrentVideo(details);
    return null;
  }

  const render = (details: VideoDetails | null = null) =>
    act(() => root.render(createElement(Player, { details })));
  const title = () => usePlayerStore.getState().currentVideo?.title;
  const play = (video: VideoSummary) => usePlayerStore.setState({ currentVideo: video, queue: [video] });

  beforeEach(() => {
    vi.clearAllMocks();
    getOriginalTitle.mockResolvedValue("Título original");
    setEnabled(true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    usePlayerStore.setState({ currentVideo: null, queue: [] });
    setEnabled(false);
  });

  it("leaves the playing video alone while switched off", async () => {
    setEnabled(false);
    play(playing(freshId()));
    render();
    await flush();

    expect(getOriginalTitle).not.toHaveBeenCalled();
    expect(title()).toBe("Translated title");
  });

  it("replaces the listed title on the video and its queue row", async () => {
    play(playing(freshId()));
    render();
    await flush();

    expect(title()).toBe("Título original");
    expect(usePlayerStore.getState().queue[0]?.title).toBe("Título original");
  });

  // A later sibling's layout effect runs in the same commit, before the browser paints.
  it("applies a title a card already looked up before the first paint", async () => {
    const id = freshId();
    await loadOriginalTitle(id);
    play(playing(id));
    let beforePaint: string | undefined;
    function PaintProbe() {
      useLayoutEffect(() => {
        beforePaint = title();
      }, []);
      return null;
    }

    act(() =>
      root.render(
        createElement(Fragment, null, createElement(Player, { details: null }), createElement(PaintProbe)),
      ),
    );

    expect(beforePaint).toBe("Título original");
  });

  it("uses the details title when oEmbed has none", async () => {
    const id = freshId();
    getOriginalTitle.mockResolvedValue(null);
    play(playing(id));
    render();
    await flush();
    expect(title()).toBe("Translated title");

    render({ id, title: "Título del reproductor" } as VideoDetails);
    await flush();

    expect(title()).toBe("Título del reproductor");
  });

  it("ignores details that belong to another video", async () => {
    const id = freshId();
    getOriginalTitle.mockResolvedValue(null);
    play(playing(id));
    render({ id: "someoneelse", title: "Other video" } as VideoDetails);
    await flush();

    expect(title()).toBe("Translated title");
  });

  // The watch page fills in a cold open's channel only while the title is empty.
  it("does not touch a cold open's empty stub", async () => {
    play(playing(freshId(), ""));
    render();
    await flush();

    expect(getOriginalTitle).not.toHaveBeenCalled();
    expect(title()).toBe("");
  });

  it("corrects a cold open once the watch page has named it", async () => {
    const id = freshId();
    play(playing(id, ""));
    render();
    await flush();

    act(() => usePlayerStore.getState().enrichCurrentVideo(id, { title: "Translated fallback" }));
    await flush();

    expect(title()).toBe("Título original");
  });

  it("drops a late answer for a video that is no longer playing", async () => {
    let answer: (title: string) => void = () => undefined;
    getOriginalTitle.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const [first, second] = [freshId(), freshId()];
    play(playing(first));
    render();
    await flush();

    getOriginalTitle.mockResolvedValue("Second original");
    act(() => play(playing(second)));
    await flush();
    answer("First original");
    await flush();

    expect(usePlayerStore.getState().currentVideo?.id).toBe(second);
    expect(title()).toBe("Second original");
  });

  it("applies when the switch is turned on during a video", async () => {
    setEnabled(false);
    play(playing(freshId()));
    render();
    await flush();

    act(() => setEnabled(true));
    await flush();

    expect(title()).toBe("Título original");
  });

  // The stream load effect is keyed on the id, so a title change must leave it alone.
  it("keeps the video id when it changes the title", async () => {
    const id = freshId();
    play(playing(id));
    const ids: (string | undefined)[] = [];
    const unsubscribe = usePlayerStore.subscribe((state) => ids.push(state.currentVideo?.id));
    render();
    await flush();
    unsubscribe();

    expect(new Set(ids)).toEqual(new Set([id]));
    expect(usePlayerStore.getState().currentVideo?.channelName).toBe("RTVE");
  });
});
