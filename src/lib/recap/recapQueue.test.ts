import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: unknown[][] = [];
let deepFlow = false;
let failNext = false;
let failWith = "down";

vi.mock("../api/env", () => ({ isTauriEnv: async () => true }));
vi.mock("../api/recap", () => ({
  recordRecapBatch: async (entries: unknown[]) => {
    if (failNext) {
      failNext = false;
      throw new Error(failWith);
    }
    sent.push(entries);
  },
}));
vi.mock("../deepFlow", () => ({ isDeepFlowCurrentlyActive: () => deepFlow }));
vi.mock("../profiles/beforeSwitch", () => ({ onBeforeProfileSwitch: () => () => {} }));

const {
  flushRecapQueue,
  recapAction,
  recapArtistSaidNo,
  recapDislike,
  recapDislikeRemoved,
  recapListen,
  recapQueriesCleared,
  recapSearch,
  recapSponsorSkip,
  recapVideoAction,
  recapView,
} = await import("./recapQueue");

const view = {
  videoId: "v",
  title: "t",
  channelId: "c",
  channelName: "n",
  format: "LONG" as const,
  watchedMs: 1000,
  counted: true,
  skipped: false,
  continued: false,
};
const listen = { trackId: "s", title: "t", artistName: "a", listenedMs: 1000, counted: true, skipped: false, continued: false };

const kinds = () => sent.flat().map((entry) => (entry as { kind: string }).kind);

describe("recap queue", () => {
  beforeEach(async () => {
    deepFlow = false;
    await flushRecapQueue();
    sent.length = 0;
  });

  it("records nothing that Deep Flow stops", async () => {
    deepFlow = true;
    recapView(view);
    recapListen(listen);
    recapDislike({ id: "v", title: "t" });
    recapAction("LIKE");
    recapSearch("lofi");
    recapSponsorSkip({ channelName: "A channel" }, "sponsor", 1000);
    await flushRecapQueue();
    expect(sent).toEqual([]);
  });

  it("still takes back what is stored during Deep Flow, and notes an artist said no to", async () => {
    deepFlow = true;
    recapDislikeRemoved("v");
    recapQueriesCleared();
    recapArtistSaidNo(null, "a", true);
    await flushRecapQueue();
    expect(kinds()).toEqual(["dislikeRemoved", "queriesCleared", "artistSaidNo"]);
  });

  it("sends everything queued as one batch", async () => {
    recapView(view);
    recapListen(listen);
    recapAction("SAVE");
    expect(sent).toEqual([]);
    await flushRecapQueue();
    expect(sent).toHaveLength(1);
    expect(kinds()).toEqual(["view", "listen", "action"]);
  });

  it("sends a batch early once it is large", async () => {
    for (let i = 0; i < 64; i++) recapAction("LIKE");
    await flushRecapQueue();
    expect(sent.flat()).toHaveLength(64);
  });

  it("keeps a batch the backend refused and sends it next time", async () => {
    failNext = true;
    recapAction("LIKE");
    await flushRecapQueue();
    expect(sent).toEqual([]);
    recapAction("SAVE");
    await flushRecapQueue();
    expect(sent.flat().map((entry) => (entry as { action: string }).action)).toEqual(["LIKE", "SAVE"]);
  });

  it("drops a batch the command can't read, so it can't hold up later ones", async () => {
    failNext = true;
    failWith = "invalid args `entries` for command `recap_record_batch`: invalid type: floating point";
    recapAction("LIKE");
    await flushRecapQueue();
    failWith = "down";
    recapAction("SAVE");
    await flushRecapQueue();
    expect(sent.flat().map((entry) => (entry as { action: string }).action)).toEqual(["SAVE"]);
  });

  it("sends a sponsor skip as whole milliseconds", async () => {
    recapSponsorSkip({ channelName: "A channel" }, "sponsor", 1234.5678);
    await flushRecapQueue();
    expect((sent.flat()[0] as { skippedMs: number }).skippedMs).toBe(1235);
  });

  it("writes within two seconds, in one batch", async () => {
    vi.useFakeTimers();
    try {
      recapAction("LIKE");
      recapAction("SAVE");
      await vi.advanceTimersByTimeAsync(2_000);
      await flushRecapQueue();
    } finally {
      vi.useRealTimers();
    }
    expect(sent.length).toBe(1);
    expect(sent[0]!.length).toBe(2);
  });

  it("leaves a sponsor skip on music out of the video ledger", async () => {
    recapSponsorSkip({ channelName: "Artist - Topic" }, "sponsor", 1000);
    await flushRecapQueue();
    expect(sent).toEqual([]);
  });

  it("leaves actions on music out of the video ledger", async () => {
    recapVideoAction({ channelName: "Artist - Topic" }, "LIKE");
    recapVideoAction({ channelName: "A channel" }, "SAVE");
    await flushRecapQueue();
    expect(sent.flat().map((entry) => (entry as { action: string }).action)).toEqual(["SAVE"]);
  });
});
