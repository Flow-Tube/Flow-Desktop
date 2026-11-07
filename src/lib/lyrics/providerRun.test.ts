import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LyricsEntry } from "./types";
import { runLyricsSources, type LyricsAnswer, type LyricsKind, type LyricsReply, type LyricsRunResult } from "./providerRun";

const entries: LyricsEntry[] = [{ time: 1000, text: "A line" }];
const found = (kind: LyricsKind): LyricsReply => ({ type: "found", kind, entries });
const MISS: LyricsReply = { type: "miss" };
const FAILED: LyricsReply = { type: "failed" };

/** Sources answer when told to, so each test sets the order things happen in. */
function setUp(sources: string[], alreadyShown: LyricsKind | null = null, refuse = false) {
  const replies = new Map<string, (reply: LyricsReply) => void>();
  const asked: string[] = [];
  const shown: LyricsAnswer[] = [];
  let result: LyricsRunResult | null = null;
  void runLyricsSources({
    sources,
    preferred: sources[0] ?? "",
    alreadyShown,
    ask: (source) =>
      new Promise((resolve) => {
        asked.push(source);
        replies.set(source, resolve);
      }),
    show: (answer) => {
      if (refuse) return false;
      shown.push(answer);
      return true;
    },
    signal: new AbortController().signal,
  }).then((value) => {
    result = value;
  });
  return {
    asked,
    shown,
    result: () => result,
    reply: async (source: string, reply: LyricsReply) => {
      replies.get(source)!(reply);
      await vi.advanceTimersByTimeAsync(0);
    },
    wait: (ms: number) => vi.advanceTimersByTimeAsync(ms),
  };
}

describe("runLyricsSources", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts two, a third at 2 s, and never more than three", async () => {
    const run = setUp(["a", "b", "c", "d"]);
    expect(run.asked).toEqual(["a", "b"]);
    await run.wait(2000);
    expect(run.asked).toEqual(["a", "b", "c"]);
    await run.wait(5000);
    expect(run.asked).toEqual(["a", "b", "c"]);
  });

  it("starts the next source as soon as one comes back without synced lyrics", async () => {
    const run = setUp(["a", "b", "c", "d"]);
    await run.reply("b", MISS);
    expect(run.asked).toEqual(["a", "b", "c"]);
    await run.reply("c", found("plain"));
    expect(run.asked).toEqual(["a", "b", "c", "d"]);
  });

  it("shows word sync at once and ends", async () => {
    const run = setUp(["a", "b"]);
    await run.reply("b", found("word"));
    expect(run.shown.map((answer) => answer.provider)).toEqual(["b"]);
    expect(run.result()?.best?.provider).toBe("b");
  });

  it("holds a line-synced answer for the preferred source, up to 2.5 s", async () => {
    const run = setUp(["a", "b"]);
    await run.reply("b", found("line"));
    await run.wait(800);
    expect(run.shown).toEqual([]);
    await run.wait(1700);
    expect(run.shown.map((answer) => answer.provider)).toEqual(["b"]);
  });

  it("prefers the preferred source's line sync when it lands during the hold", async () => {
    const run = setUp(["a", "b"]);
    await run.reply("b", found("line"));
    await run.wait(300);
    await run.reply("a", found("line"));
    await run.wait(500);
    expect(run.shown.map((answer) => answer.provider)).toEqual(["a"]);
  });

  it("swaps a shown line for word sync that lands later", async () => {
    const run = setUp(["a", "b", "c"]);
    await run.reply("a", found("line"));
    await run.wait(800);
    expect(run.shown.map((answer) => answer.provider)).toEqual(["a"]);
    await run.reply("b", found("word"));
    expect(run.shown.map((answer) => `${answer.provider}:${answer.kind}`)).toEqual(["a:line", "b:word"]);
    expect(run.result()?.best?.kind).toBe("word");
  });

  it("doesn't swap a shown line for another source's line", async () => {
    const run = setUp(["a", "b"]);
    await run.reply("a", found("line"));
    await run.wait(800);
    await run.reply("b", found("line"));
    expect(run.shown.map((answer) => answer.provider)).toEqual(["a"]);
  });

  it("shows plain text only when the run ends with nothing else", async () => {
    const run = setUp(["a", "b"]);
    await run.reply("a", found("plain"));
    expect(run.shown).toEqual([]);
    await run.reply("b", MISS);
    expect(run.shown.map((answer) => answer.kind)).toEqual(["plain"]);
  });

  it("keeps the saved plain text over a new plain answer, but lets line sync replace it", async () => {
    const run = setUp(["a", "b"], "plain");
    await run.reply("a", found("plain"));
    expect(run.shown).toEqual([]);
    await run.reply("b", found("line"));
    await run.wait(800);
    expect(run.shown.map((answer) => answer.kind)).toEqual(["line"]);
  });

  it("stops at 9 s", async () => {
    const run = setUp(["a", "b"]);
    await run.wait(9000);
    expect(run.result()).toEqual({ best: null, everySourceMissed: false, someSourceReplied: false });
  });

  it("counts every source missing only when all answered", async () => {
    const run = setUp(["a", "b", "c"]);
    await run.reply("a", MISS);
    await run.reply("b", MISS);
    await run.reply("c", MISS);
    expect(run.result()).toEqual({ best: null, everySourceMissed: true, someSourceReplied: true });
  });

  it("doesn't count a failure as a miss", async () => {
    const run = setUp(["a", "b"]);
    await run.reply("a", FAILED);
    await run.reply("b", MISS);
    expect(run.result()?.everySourceMissed).toBe(false);
    expect(run.result()?.someSourceReplied).toBe(true);
  });

  it("doesn't count a refused answer as shown", async () => {
    const run = setUp(["a"], null, true);
    await run.reply("a", found("word"));
    expect(run.result()?.best).toBeNull();
  });

  it("ends at once with no sources", async () => {
    const run = setUp([]);
    await run.wait(0);
    expect(run.result()).toEqual({ best: null, everySourceMissed: false, someSourceReplied: false });
  });
});
