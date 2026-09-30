import { describe, expect, it } from "vitest";

import { chooseDiscordSurface } from "./useDiscordPresence";

const playing = { present: true, playing: true };
const paused = { present: true, playing: false };
const absent = { present: false, playing: false };

describe("chooseDiscordSurface", () => {
  it("shows nothing when off", () => {
    expect(chooseDiscordSurface("off", playing, playing)).toBeNull();
  });

  it("gates by mode", () => {
    expect(chooseDiscordSurface("music", absent, playing)).toBeNull();
    expect(chooseDiscordSurface("videos", playing, absent)).toBeNull();
    expect(chooseDiscordSurface("music", playing, absent)).toBe("music");
    expect(chooseDiscordSurface("videos", absent, playing)).toBe("video");
  });

  it("prefers a playing surface over a paused one", () => {
    expect(chooseDiscordSurface("musicAndVideos", paused, playing)).toBe("video");
    expect(chooseDiscordSurface("musicAndVideos", playing, paused)).toBe("music");
  });

  it("prefers music over video when both qualify", () => {
    expect(chooseDiscordSurface("musicAndVideos", playing, playing)).toBe("music");
    expect(chooseDiscordSurface("musicAndVideos", paused, paused)).toBe("music");
  });

  it("falls back to whichever surface is present", () => {
    expect(chooseDiscordSurface("musicAndVideos", absent, playing)).toBe("video");
    expect(chooseDiscordSurface("musicAndVideos", absent, absent)).toBeNull();
  });
});
