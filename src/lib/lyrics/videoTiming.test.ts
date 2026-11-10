import { beforeEach, describe, expect, it, vi } from "vitest";

const lookups = vi.hoisted(() => ({ calls: 0, answer: (): Promise<unknown> => Promise.resolve([]) }));

vi.mock("../api/foss", () => ({
  getNonMusicSegments: () => {
    lookups.calls++;
    return lookups.answer();
  },
}));
vi.mock("../../store/useSettingsStore", () => ({
  useSettingsStore: { getState: () => ({ loadSettings: async () => {}, serverUrl: "https://sb.example" }) },
}));

const { fitToVideo } = await import("./videoTiming");

const lines = [
  { time: 5_000, text: "One" },
  { time: 20_000, text: "Two" },
  { time: 100_000, text: "Three" },
];
const intro = (videoDurationSeconds: number) => [{ startSeconds: 0, endSeconds: 60, videoDurationSeconds }];

describe("fitting lyrics to a music video", () => {
  beforeEach(() => {
    lookups.calls = 0;
  });

  it("moves lines past the video's non-music parts and asks once per video", async () => {
    lookups.answer = async () => intro(300);
    expect((await fitToVideo("video-a", lines, 300)).map((l) => l.time)).toEqual([65_000, 80_000, 160_000]);
    await fitToVideo("video-a", lines, 300);
    expect(lookups.calls).toBe(1);
  });

  it("ignores parts voted on for a cut of another length", async () => {
    lookups.answer = async () => intro(240);
    expect(await fitToVideo("video-b", lines, 300)).toBe(lines);
  });

  it("leaves the lyrics after a failed lookup and asks again next time", async () => {
    lookups.answer = () => Promise.reject(new Error("offline"));
    expect(await fitToVideo("video-c", lines, 300)).toBe(lines);
    lookups.answer = async () => intro(300);
    expect((await fitToVideo("video-c", lines, 300))[0]!.time).toBe(65_000);
    expect(lookups.calls).toBe(2);
  });
});
