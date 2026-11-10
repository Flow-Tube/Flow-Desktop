import { describe, expect, it } from "vitest";

import type { RecapSummary } from "../api/recap";
import { blobToBase64, drawPoster, fitText, POSTER_HEIGHT, POSTER_WIDTH, posterData } from "./recapPoster";

const item = (name: string) => ({ id: name, name, count: 1, durationMs: 0, detail: "", imageUrl: "", kind: "OTHER" as const });

const summary = {
  video: { views: 12, topChannels: [item("A channel")] },
  music: { plays: 7, topArtists: [item("An artist")] },
  combined: { totalMs: 3_900_000, activeDays: 5, longestStreak: 3 },
  insights: ["NIGHT_OWL"],
} as unknown as RecapSummary;

/** A canvas context that notes what was written and how far things reach. */
function fakeContext() {
  const texts: { text: string; x: number; y: number }[] = [];
  const noop = () => {};
  const ctx = {
    measureText: (text: string) => ({ width: text.length * 10 }),
    fillText: (text: string, x: number, y: number) => texts.push({ text, x, y }),
    fillRect: noop,
    beginPath: noop,
    closePath: noop,
    arc: noop,
    fill: noop,
    clip: noop,
    save: noop,
    restore: noop,
    roundRect: noop,
    drawImage: noop,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

const palette = { ground: "a", ink: "b", tile: "c", tileInk: "d", font: "serif" };

describe("posterData", () => {
  it("takes its figures, names and first insight from the summary", () => {
    const data = posterData(summary, "September 2026");
    expect(data.totalTime).toBe("1 h 5 min");
    expect(data.tiles).toHaveLength(4);
    expect(data.tiles[0]![0]).toBe("12");
    expect(data.tiles[3]![0]).toBe("3 days");
    expect(data.channelName).toBe("A channel");
    expect(data.artistName).toBe("An artist");
    expect(data.insight).toBe("Night owl");
  });
});

describe("fitText", () => {
  const ctx = { measureText: (text: string) => ({ width: text.length * 10 }) } as unknown as CanvasRenderingContext2D;

  it("leaves text that fits alone and shortens the rest", () => {
    expect(fitText(ctx, "short", 100)).toBe("short");
    expect(fitText(ctx, "a much longer name", 100)).toBe("a much lo…");
  });
});

describe("drawPoster", () => {
  it("writes every figure inside the poster, without overlapping the portraits", () => {
    const { ctx, texts } = fakeContext();
    drawPoster(ctx, posterData(summary, "September 2026"), { channel: null, artist: null }, palette);
    const written = texts.map((entry) => entry.text);
    for (const text of ["Flow Recap", "September 2026", "1 h 5 min", "12", "3 days", "A channel", "An artist", "Night owl", "Made with Flow"]) {
      expect(written).toContain(text);
    }
    for (const entry of texts) {
      expect(entry.y).toBeGreaterThan(0);
      expect(entry.y).toBeLessThanOrEqual(POSTER_HEIGHT);
      expect(entry.x).toBeLessThanOrEqual(POSTER_WIDTH);
    }
    const time = texts.find((entry) => entry.text === "1 h 5 min")!;
    expect(time.y).toBeGreaterThan(72 + 190 + 372);
  });

  it("still draws with no channel, artist or insight", () => {
    const { ctx, texts } = fakeContext();
    const data = { ...posterData(summary, "2026"), channelName: null, artistName: null, insight: null };
    drawPoster(ctx, data, { channel: null, artist: null }, palette);
    expect(texts.map((entry) => entry.text)).toContain("Made with Flow");
  });
});

describe("blobToBase64", () => {
  it("gives the bytes without the data URL's prefix", async () => {
    await expect(blobToBase64(new Blob(["hi"], { type: "image/png" }))).resolves.toBe("aGk=");
  });
});
