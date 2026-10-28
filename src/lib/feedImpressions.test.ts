import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ recordFeedImpressions: vi.fn(), recordSeenVideos: vi.fn() }));
vi.mock("./api/recommendation", () => api);

import { noteImpression, noteSeen, resetImpressionsForTest } from "./feedImpressions";

const card = (id: string) => ({ id, title: id, channelName: "c" });

describe("noteImpression", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetImpressionsForTest();
    api.recordFeedImpressions.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it("sends each card once per session, in one batch", async () => {
    noteImpression(card("a"));
    noteImpression(card("b"));
    noteImpression(card("a"));
    await vi.runAllTimersAsync();
    expect(api.recordFeedImpressions).toHaveBeenCalledTimes(1);
    expect(api.recordFeedImpressions.mock.calls[0]?.[0].map((v: { id: string }) => v.id)).toEqual(["a", "b"]);

    noteImpression(card("a"));
    await vi.runAllTimersAsync();
    expect(api.recordFeedImpressions).toHaveBeenCalledTimes(1);
  });

  it("lets a card count again when sending failed", async () => {
    api.recordFeedImpressions.mockRejectedValueOnce(new Error("db"));
    noteImpression(card("a"));
    await vi.runAllTimersAsync();
    noteImpression(card("a"));
    await vi.runAllTimersAsync();
    expect(api.recordFeedImpressions).toHaveBeenCalledTimes(2);
  });
});

describe("noteSeen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetImpressionsForTest();
    api.recordFeedImpressions.mockReset().mockResolvedValue(undefined);
    api.recordSeenVideos.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it("records ids for the seen list without teaching the ranker", async () => {
    noteSeen(card("r1"));
    noteSeen(card("r2"));
    noteSeen(card("r1"));
    await vi.runAllTimersAsync();
    expect(api.recordSeenVideos).toHaveBeenCalledWith(["r1", "r2"]);
    expect(api.recordFeedImpressions).not.toHaveBeenCalled();
  });
});
