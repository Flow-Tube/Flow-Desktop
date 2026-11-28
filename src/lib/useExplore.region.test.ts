// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExplorePage, ExploreTab } from "../types/video";

const getExploreDestination = vi.fn();
const getExplorePage = vi.fn();
vi.mock("./api/youtube", () => ({
  getExploreDestination: (...args: unknown[]) => getExploreDestination(...args),
  getExplorePage: (...args: unknown[]) => getExplorePage(...args),
  getExploreGrid: async () => ({ videos: [], continuation: null }),
}));
vi.mock("./usePreference", async () => {
  const { useState } = await import("react");
  return {
    usePreference: (_key: string, fallback: string) => useState(fallback),
    useBoolPref: (_key: string, fallback: boolean) => useState(fallback),
  };
});

const { useExplore } = await import("./useExplore");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sports: ExploreTab = { title: "Sports", target: { browseId: "FEnews_destination", params: "sports" }, selected: false };
const page = (title: string): ExplorePage => ({ title, tabs: [sports], shelves: [{ title, videos: [] }] });

let explore: ReturnType<typeof useExplore>;
let root: Root;
function Probe() {
  explore = useExplore("news");
  return null;
}

beforeEach(() => {
  getExploreDestination.mockReset().mockImplementation(async (_id: string, region: string) => page(region));
  getExplorePage.mockReset().mockImplementation(async (_target: unknown, region: string) => page(`${region} tab`));
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(async () => root.unmount()));

describe("useExplore region", () => {
  it("starts a new country at the destination, leaving the old country's tab and See all", async () => {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => explore.selectTab(sports));
    expect(getExplorePage).toHaveBeenCalledWith(sports.target, "US");
    await act(async () => explore.openSeeAll({ title: "US", videos: [], more: sports.target }));
    expect(explore.seeAll).not.toBeNull();

    await act(async () => explore.setRegion("JP"));
    expect(getExploreDestination).toHaveBeenLastCalledWith("news", "JP");
    expect(getExplorePage).toHaveBeenCalledTimes(1);
    expect(explore.seeAll).toBeNull();
    expect(explore.page?.title).toBe("JP");
  });
});
