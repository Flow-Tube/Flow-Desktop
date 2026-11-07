import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const lookups = vi.hoisted(() => ({ answers: [] as Array<() => Promise<string | null>> }));
vi.mock("./animatedArtwork", () => ({
  artworkLoopFor: () => (lookups.answers.shift() ?? (() => Promise.resolve(null)))(),
  forgetArtworkLoop: () => {},
}));
vi.mock("./api/images", () => ({ proxyArtworkLoop: async (url: string) => `proxied:${url}` }));
vi.mock("./usePreference", () => ({ useBoolPref: () => [true, () => {}] }));

const { useAnimatedArtwork } = await import("./useAnimatedArtwork");
import type { SongItem } from "../types/music";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const song = { id: "s", videoId: "s", title: "Yellow", artists: [{ name: "Coldplay", id: null }] } as unknown as SongItem;
let shown: string | null = null;
function Probe() {
  shown = useAnimatedArtwork(song).loopUrl;
  return null;
}

describe("animated cover lookups", () => {
  afterEach(() => vi.useRealTimers());

  it("asks again 20 s and 60 s after a failure while the song stays on screen", async () => {
    vi.useFakeTimers();
    const busy = () => Promise.reject(new Error("Artwork service answered 503"));
    lookups.answers = [busy, busy, () => Promise.resolve("loop")];
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Probe)));
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(shown).toBeNull();
    await act(async () => void (await vi.advanceTimersByTimeAsync(20_000)));
    expect(shown).toBeNull();
    await act(async () => void (await vi.advanceTimersByTimeAsync(40_000)));
    expect(shown).toBe("proxied:loop");
    await act(async () => root.unmount());
  });
});
