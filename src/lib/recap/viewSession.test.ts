import { describe, expect, it } from "vitest";

import type { ViewFormat } from "../api/recap";
import { RecapViewSession, watchedStep, type ViewStretch } from "./viewSession";

function session(format: ViewFormat = "LONG", fraction?: number) {
  const sent: ViewStretch[] = [];
  const view = new RecapViewSession(() => format, (stretch) => sent.push(stretch), fraction);
  return { sent, view };
}

/** Plays from `from` to `to` seconds in steps of one second of wall clock. */
function play(view: RecapViewSession, from: number, to: number, duration: number, startWallMs = 0) {
  for (let t = from; t <= to; t++) view.tick(t * 1000, duration * 1000, startWallMs + (t - from) * 1000);
}

describe("watchedStep", () => {
  it("never counts more than the position moved", () => {
    expect(watchedStep(1000, 500)).toBe(500);
    expect(watchedStep(500, 1000)).toBe(500);
  });

  it("adds nothing for a pause or a seek back, and only the elapsed time for a seek forward", () => {
    expect(watchedStep(60_000, 0)).toBe(0);
    expect(watchedStep(1000, -30_000)).toBe(0);
    expect(watchedStep(1000, 90_000)).toBe(1000);
  });
});

describe("RecapViewSession", () => {
  it("sends the time at most five seconds late", () => {
    const { sent, view } = session();
    play(view, 0, 6, 600);
    expect(sent.reduce((sum, s) => sum + s.watchedMs, 0)).toBe(5_000);
  });

  it("sends whole milliseconds from fractional positions, and loses none of the time", () => {
    const { sent, view } = session();
    for (let i = 0; i <= 800; i++) view.tick(i * 249.63, 600_000.5, i * 250);
    view.close();
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.every((stretch) => Number.isInteger(stretch.watchedMs))).toBe(true);
    expect(sent.reduce((sum, s) => sum + s.watchedMs, 0)).toBe(199_704);
  });

  it("counts a view once, past a fifth of the video", () => {
    const { sent, view } = session();
    play(view, 0, 30, 100);
    view.close();
    expect(sent.filter((s) => s.counted)).toHaveLength(1);
    expect(sent.reduce((sum, s) => sum + s.watchedMs, 0)).toBe(30_000);
    expect(sent[0]!.continued).toBe(false);
    expect(sent[sent.length - 1]!.skipped).toBe(false);
  });

  it("marks a real abandonment as a skip when it closes, and a bounce as nothing", () => {
    const abandoned = session();
    play(abandoned.view, 0, 15, 1000);
    abandoned.view.close();
    expect(abandoned.sent[abandoned.sent.length - 1]).toMatchObject({ counted: false, skipped: true, continued: true });
    expect(abandoned.sent.reduce((sum, s) => sum + s.watchedMs, 0)).toBe(15_000);

    const bounce = session();
    play(bounce.view, 0, 5, 1000);
    bounce.view.close();
    expect(bounce.sent[bounce.sent.length - 1]).toEqual({ watchedMs: 5_000, counted: false, skipped: false, continued: false });
  });

  it("sends time as it goes, each stretch only once", () => {
    const { sent, view } = session();
    play(view, 0, 90, 10_000);
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(sent[1]!.continued).toBe(true);
    view.close();
    expect(sent.reduce((sum, s) => sum + s.watchedMs, 0)).toBe(90_000);
    view.close();
    expect(sent.filter((s) => s.skipped)).toHaveLength(1);
  });

  it("grades a live stream by time watched and never calls it a skip", () => {
    const short = session("LIVE");
    play(short.view, 0, 30, 0);
    short.view.close();
    expect(short.sent.some((s) => s.counted || s.skipped)).toBe(false);

    const long = session("LIVE");
    play(long.view, 0, 61, 0);
    long.view.close();
    expect(long.sent.filter((s) => s.counted)).toHaveLength(1);
  });

  it("sends nothing for a session that never played", () => {
    const { sent, view } = session();
    view.close();
    expect(sent).toEqual([]);
  });

  it("holds music to its own share", () => {
    const { sent, view } = session("LONG", 0.5);
    play(view, 0, 40, 100);
    view.close();
    expect(sent.some((s) => s.counted)).toBe(false);
  });
});
