import { describe, expect, it } from "vitest";
import { decideRouteChangePlayerAction, decideWatchRouteSync, type WatchRouteSyncInput } from "./watchRouteSync";

const sync = (overrides: Partial<WatchRouteSyncInput>) =>
  decideWatchRouteSync({
    routeVideoId: "old",
    currentVideoId: "old",
    routeChanged: false,
    retryRequested: false,
    queuedIndex: -1,
    hasOfflineRecord: false,
    ...overrides,
  });

describe("decideWatchRouteSync", () => {
  it("leaves the player alone while the store is ahead of the route", () => {
    // A related click: the queue holds the new video, the route still the old one.
    expect(sync({ currentVideoId: "new" })).toEqual({ kind: "none" });
  });

  it("does nothing once the route catches up with the player", () => {
    expect(sync({ routeVideoId: "new", currentVideoId: "new", routeChanged: true })).toEqual({ kind: "none" });
  });

  it("plays a queued video the route moved to", () => {
    expect(sync({ routeVideoId: "prev", currentVideoId: "new", routeChanged: true, queuedIndex: 2 })).toEqual({
      kind: "play-queued",
      index: 2,
    });
  });

  it("starts a cold open from a stub, or from the download", () => {
    expect(sync({ routeVideoId: "deep", currentVideoId: null, routeChanged: true })).toEqual({ kind: "play-stub" });
    expect(sync({ routeVideoId: "deep", currentVideoId: "other", routeChanged: true, hasOfflineRecord: true })).toEqual({
      kind: "play-offline",
    });
  });

  it("restarts the route's video when nothing is playing or on retry", () => {
    expect(sync({ currentVideoId: null })).toEqual({ kind: "play-stub" });
    expect(sync({ currentVideoId: "new", retryRequested: true })).toEqual({ kind: "play-stub" });
  });

  it("ignores a page that is not a watch route", () => {
    expect(sync({ routeVideoId: undefined, currentVideoId: null, routeChanged: true })).toEqual({ kind: "none" });
  });
});

describe("decideRouteChangePlayerAction", () => {
  const base = {
    previousWatchId: "a",
    nextWatchId: null,
    currentVideoId: "a",
    videoPlayerMode: "watch" as const,
    autoPipEnabled: true,
  };

  it("shrinks the video into the mini player when leaving its page, paused or playing", () => {
    expect(decideRouteChangePlayerAction(base)).toBe("enter-pip");
    expect(decideRouteChangePlayerAction({ ...base, autoPipEnabled: false })).toBe("dismiss");
  });

  it("expands the mini player when its video's page opens", () => {
    expect(decideRouteChangePlayerAction({ ...base, nextWatchId: "a", videoPlayerMode: "pip" })).toBe("expand");
  });

  it("keeps the player when the route moves between watch pages", () => {
    expect(decideRouteChangePlayerAction({ ...base, nextWatchId: "b" })).toBe("none");
  });

  it("keeps the player when the page left was another video's", () => {
    expect(decideRouteChangePlayerAction({ ...base, previousWatchId: "b" })).toBe("none");
  });

  it("leaves the pop-out window and the mini player where they are", () => {
    expect(decideRouteChangePlayerAction({ ...base, videoPlayerMode: "window" })).toBe("none");
    expect(decideRouteChangePlayerAction({ ...base, videoPlayerMode: "pip" })).toBe("none");
  });
});
