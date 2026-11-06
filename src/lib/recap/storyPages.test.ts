import { describe, expect, it } from "vitest";

import type { RecapSummary } from "../api/recap";
import { advanceStory, STORY_PAGE_MS, storyPageAt } from "./storyClock";
import { storyPages } from "./storyPages";

const item = (name: string, count = 1) => ({ id: name, name, count, durationMs: 0, detail: "", imageUrl: "", kind: "OTHER" as const });

function summary(overrides: Partial<{ video: object; music: object; combined: object }> = {}): RecapSummary {
  return {
    video: {
      topChannels: [],
      topVideos: [],
      topTopics: [],
      discoveredChannels: [],
      dislikes: [],
      skippedVideos: [],
      formatMs: {},
      sponsorSavedMs: 0,
      ...overrides.video,
    },
    music: {
      plays: 0,
      topArtists: [],
      topTracks: [],
      discoveredArtists: [],
      skippedTracks: [],
      activity: { totalMs: 0 },
      ...overrides.music,
    },
    combined: { hourCounts: [0], longestStreak: 0, ...overrides.combined },
  } as unknown as RecapSummary;
}

const kinds = (s: RecapSummary) => storyPages(s).map((page) => page.kind);

describe("storyPages", () => {
  it("is an intro and a summary when the period earned nothing else", () => {
    expect(kinds(summary())).toEqual(["intro", "summary"]);
  });

  it("adds each page only when its data is there", () => {
    expect(kinds(summary({ video: { topVideos: [item("once")] } }))).toEqual(["intro", "summary"]);
    expect(kinds(summary({ video: { topVideos: [item("twice", 2)] } }))).toContain("onRepeat");
    expect(kinds(summary({ combined: { hourCounts: [0], longestStreak: 1 } }))).not.toContain("streak");
    expect(kinds(summary({ combined: { hourCounts: [1], longestStreak: 2 } }))).toEqual(["intro", "clock", "streak", "summary"]);
    expect(kinds(summary({ video: { sponsorSavedMs: 5 } }))).toContain("sponsor");
  });

  it("gives the top artist their share of the plays and the channel its runners-up", () => {
    const pages = storyPages(
      summary({
        video: { topChannels: [1, 2, 3, 4, 5, 6].map((n) => item(`c${n}`)) },
        music: { plays: 8, topArtists: [item("a", 2)] },
      }),
    );
    const channel = pages.find((page) => page.kind === "topChannel");
    expect(channel?.kind === "topChannel" && channel.runnersUp).toHaveLength(4);
    const artist = pages.find((page) => page.kind === "topArtist");
    expect(artist?.kind === "topArtist" && artist.sharePercent).toBe(25);
  });

  it("counts music as a format next to video", () => {
    expect(kinds(summary({ video: { formatMs: { LONG: 1 } } }))).not.toContain("formats");
    expect(kinds(summary({ video: { formatMs: { LONG: 1 } }, music: { activity: { totalMs: 1 } } }))).toContain("formats");
  });
});

describe("advanceStory", () => {
  it("runs a page for its time and then turns it", () => {
    let position = { page: 0, elapsedMs: STORY_PAGE_MS - 10 };
    position = advanceStory(position, 5, 3);
    expect(position).toEqual({ page: 0, elapsedMs: STORY_PAGE_MS - 5 });
    expect(advanceStory(position, 5, 3)).toEqual({ page: 1, elapsedMs: 0 });
  });

  it("waits on the last page", () => {
    expect(advanceStory({ page: 2, elapsedMs: STORY_PAGE_MS }, 16, 3)).toEqual({ page: 2, elapsedMs: STORY_PAGE_MS });
  });

  it("doesn't count time the window was hidden", () => {
    expect(advanceStory({ page: 0, elapsedMs: 0 }, 60_000, 3)).toEqual({ page: 0, elapsedMs: 100 });
  });
});

describe("storyPageAt", () => {
  it("stays inside the story", () => {
    expect(storyPageAt(-1, 3).page).toBe(0);
    expect(storyPageAt(9, 3).page).toBe(2);
  });
});
