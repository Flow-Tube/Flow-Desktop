import { describe, expect, it } from "vitest";
import { ListenTracker, listenThresholdMs, type PlayerSnapshot } from "./listenTracker";
import type { SongItem } from "../../types/music";

const song = (id: string, duration = 200): SongItem => ({
  id,
  title: `Song ${id}`,
  artists: [{ name: "Artist", id: null }],
  album: null,
  duration,
  musicVideoType: null,
  thumbnail: "",
  explicit: false,
  videoId: id,
  playlistId: null,
  params: null,
});

const snap = (track: SongItem | null, progress: number, extra: Partial<PlayerSnapshot> = {}): PlayerSnapshot => ({
  track,
  playing: true,
  buffering: false,
  progress,
  duration: track?.duration ?? 0,
  ...extra,
});

/** Plays `seconds` of audio in quarter-second steps, as timeupdate would. */
function play(tracker: ListenTracker, track: SongItem, from: number, seconds: number, startMs: number) {
  const events = [];
  for (let step = 0; step <= seconds * 4; step += 1) {
    events.push(...tracker.update(snap(track, from + step / 4), startMs + step * 250));
  }
  return events;
}

describe("listen threshold", () => {
  it("is half the track, capped at four minutes, and absent for short tracks", () => {
    expect(listenThresholdMs(200_000)).toBe(100_000);
    expect(listenThresholdMs(20 * 60_000)).toBe(4 * 60_000);
    expect(listenThresholdMs(30_000)).toBeNull();
  });
});

describe("ListenTracker", () => {
  it("announces now playing once, when audio really starts", () => {
    const tracker = new ListenTracker();
    const track = song("a");
    expect(tracker.update(snap(track, 0, { buffering: true }), 0)).toEqual([]);
    expect(tracker.update(snap(track, 0), 100)).toEqual([]);
    const started = tracker.update(snap(track, 0.25), 350);
    expect(started.map((e) => e.kind)).toEqual(["nowPlaying"]);
    expect(play(tracker, track, 0.5, 10, 600).some((e) => e.kind === "nowPlaying")).toBe(false);
  });

  it("counts the listen the moment half the song has played", () => {
    const tracker = new ListenTracker();
    const track = song("a");
    const events = play(tracker, track, 0, 101, 1_000_000);
    const listened = events.filter((e) => e.kind === "listened");
    expect(listened).toHaveLength(1);
    expect(listened[0]).toMatchObject({ durationMs: 200_000, startedAtMs: 1_000_000 });
    expect(listened[0]!.kind === "listened" && listened[0]!.playedMs).toBeGreaterThanOrEqual(100_000);
  });

  it("does not count paused, buffering or skipped time", () => {
    const tracker = new ListenTracker();
    const track = song("a");
    play(tracker, track, 0, 60, 0);
    tracker.update(snap(track, 60, { playing: false }), 60_000);
    tracker.update(snap(track, 60, { playing: false }), 600_000);
    tracker.update(snap(track, 150), 600_250);
    const after = play(tracker, track, 150, 30, 600_500);
    expect(after.some((e) => e.kind === "listened")).toBe(false);
  });

  it("never counts songs of 30 seconds or less", () => {
    const tracker = new ListenTracker();
    expect(play(tracker, song("short", 30), 0, 30, 0).some((e) => e.kind === "listened")).toBe(false);
  });

  it("starts a new listen on the next song and on a repeat", () => {
    const tracker = new ListenTracker();
    const first = song("a", 60);
    expect(play(tracker, first, 0, 59, 0).filter((e) => e.kind === "listened")).toHaveLength(1);
    const again = play(tracker, first, 0, 31, 100_000);
    expect(again.filter((e) => e.kind === "nowPlaying")).toHaveLength(1);
    expect(again.filter((e) => e.kind === "listened")).toHaveLength(1);
    const next = play(tracker, song("b", 60), 0, 31, 200_000);
    expect(next.map((e) => e.kind)).toEqual(["nowPlaying", "listened"]);
  });

  it("ignores a long gap between updates, such as the machine sleeping", () => {
    const tracker = new ListenTracker();
    const track = song("a");
    tracker.update(snap(track, 0), 0);
    tracker.update(snap(track, 0.25), 250);
    expect(tracker.update(snap(track, 0.5), 3_600_000)).toEqual([]);
  });
});
