import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getRecapWeek = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api/recap", () => ({ getRecapWeek }));
vi.mock("../../lib/recap/recapQueue", () => ({ flushRecapQueue: async () => {} }));

const { WatchTimeCard } = await import("./WatchTimeCard");

const HOUR = 3_600_000;
const days = (values: number[]): [string, number][] => values.map((ms, index) => [`2026-09-0${index + 1}`, ms]);

let host: HTMLDivElement;
let root: Root;

async function open() {
  await act(async () => root.render(createElement(WatchTimeCard)));
}

beforeEach(() => {
  getRecapWeek.mockReset();
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
});

describe("WatchTimeCard", () => {
  it("shows the daily average and the week's total, to scale", async () => {
    getRecapWeek.mockResolvedValue({ days: days([7 * HOUR, 0, 0, 0, 0, 0, 7 * HOUR]), startedAt: 0 });
    await open();
    expect(host.textContent).toContain("Daily average");
    expect(host.textContent).toContain("2 h 0 min");
    expect(host.textContent).toContain("14 h 0 min this week");
    expect(host.querySelectorAll("path")).toHaveLength(2);
    expect(host.textContent).not.toContain("Based on your watch history");
  });

  it("shows a chosen day instead of the average, and goes back", async () => {
    getRecapWeek.mockResolvedValue({ days: days([HOUR, 0, 0, 0, 0, 0, 2 * HOUR]), startedAt: 0 });
    await open();
    const day = host.querySelectorAll("button")[0]!;
    await act(async () => day.click());
    expect(host.textContent).toContain("1 h 0 min");
    expect(host.textContent).not.toContain("Daily average");
    await act(async () => day.click());
    expect(host.textContent).toContain("Daily average");
  });

  it("has an empty state, and says when the week is an estimate", async () => {
    getRecapWeek.mockResolvedValue({ days: days([0, 0, 0, 0, 0, 0, 0]), startedAt: Date.now() });
    await open();
    expect(host.textContent).toContain("No watch data yet");
    expect(host.textContent).toContain("Based on your watch history");
  });

  it("offers a retry when it can't read the ledger", async () => {
    getRecapWeek.mockRejectedValueOnce(new Error("down"));
    await open();
    expect(host.textContent).toContain("Couldn't read your watch time");
    getRecapWeek.mockResolvedValue({ days: days([HOUR, 0, 0, 0, 0, 0, 0]), startedAt: 0 });
    await act(async () => host.querySelector("button")!.click());
    expect(host.textContent).toContain("this week");
  });
});
