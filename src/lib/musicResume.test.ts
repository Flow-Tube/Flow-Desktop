import { describe, expect, it, vi } from "vitest";

const { settings, getMusicResumePosition, saveMusicResumePosition } = vi.hoisted(() => ({
  settings: { music_resume_long_tracks: "true" } as Record<string, string>,
  getMusicResumePosition: vi.fn(async (): Promise<number | null> => 23 * 60),
  saveMusicResumePosition: vi.fn(async () => {}),
}));

vi.mock("../store/useAppSettingsStore", () => ({ getSettingValue: (key: string) => settings[key] ?? "" }));
vi.mock("./api/musicQueue", () => ({ getMusicResumePosition, saveMusicResumePosition }));

import type { SongItem } from "../types/music";
import { isLongTrack, rememberResumePosition, resumePositionFor, resumeStartSeconds } from "./musicResume";

const episode = 45 * 60;
const track = (seconds: number) => ({ id: "episode0001", videoId: "episode0001", duration: seconds }) as SongItem;

// Cases ported from Android's MusicResumePolicyTest.
describe("resumeStartSeconds", () => {
  it("resumes a long track where it stopped", () => {
    expect(resumeStartSeconds(23 * 60, episode)).toBe(23 * 60);
  });

  it("always starts a song over", () => {
    expect(resumeStartSeconds(90, 4 * 60)).toBe(0);
  });

  it("counts ten minutes as long", () => {
    expect(isLongTrack(10 * 60)).toBe(true);
    expect(isLongTrack(10 * 60 - 1)).toBe(false);
  });

  it("starts a finished track over", () => {
    expect(resumeStartSeconds(episode, episode)).toBe(0);
    expect(resumeStartSeconds(episode * 0.99, episode)).toBe(0);
  });

  it("never resumes a track of unknown length", () => {
    expect(resumeStartSeconds(60, 0)).toBe(0);
  });
});

describe("the resume setting", () => {
  it("reads and writes positions only while it is on, and only for long tracks", async () => {
    expect(await resumePositionFor(track(episode))).toBe(23 * 60);
    rememberResumePosition(track(episode), 30 * 60, episode);
    rememberResumePosition(track(200), 100, 200);
    expect(saveMusicResumePosition).toHaveBeenCalledTimes(1);

    settings.music_resume_long_tracks = "false";
    expect(await resumePositionFor(track(episode))).toBe(0);
    rememberResumePosition(track(episode), 30 * 60, episode);
    expect(saveMusicResumePosition).toHaveBeenCalledTimes(1);
  });
});
