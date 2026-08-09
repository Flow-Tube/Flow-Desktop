import { describe, expect, it } from "vitest";
import {
  AUDIO_RESYNC_MIN_INTERVAL_MS,
  decideExternalAudioSync,
  type ExternalAudioSyncInput,
} from "./externalAudioSync";

const settled: ExternalAudioSyncInput = {
  drift: 0,
  held: false,
  videoAdvancing: true,
  audioSeeking: false,
  audioReadyState: 4,
  msSinceLastRealign: 10_000,
};

const decide = (overrides: Partial<ExternalAudioSyncInput> = {}) =>
  decideExternalAudioSync({ ...settled, ...overrides });

describe("decideExternalAudioSync", () => {
  it("leaves a clock inside tolerance alone", () => {
    expect(decide()).toBe("steady");
    expect(decide({ drift: 0.4 })).toBe("steady");
    expect(decide({ drift: -0.4 })).toBe("steady");
  });

  it("holds instead of rewinding when the video has stopped advancing", () => {
    // The runaway this replaced: audio ahead -> rewind -> video still stuck ->
    // rewind again, replaying the same seconds of audio forever.
    expect(decide({ drift: 1.5, videoAdvancing: false })).toBe("hold");
    expect(decide({ drift: 30, videoAdvancing: false })).toBe("hold");
  });

  it("treats audio ahead of a healthy video as ordinary drift", () => {
    expect(decide({ drift: 1.5 })).toBe("realign");
  });

  it("keeps holding until the video has actually caught up", () => {
    expect(decide({ held: true, drift: 0.9 })).toBe("wait");
    expect(decide({ held: true, drift: 0.2 })).toBe("wait");
    expect(decide({ held: true, drift: 0.1 })).toBe("resume");
    expect(decide({ held: true, drift: -0.4 })).toBe("resume");
  });

  it("realigns audio that fell behind, once it can take the write", () => {
    expect(decide({ drift: -2 })).toBe("realign");
  });

  it("does not interrupt an element still recovering from the last correction", () => {
    // Each of these is a way the old loop cancelled its own in-flight fetch and
    // left the video playing silently after a seek, resume or quality switch.
    expect(decide({ drift: -2, msSinceLastRealign: AUDIO_RESYNC_MIN_INTERVAL_MS - 1 })).toBe("wait");
    expect(decide({ drift: -2, audioSeeking: true })).toBe("wait");
    expect(decide({ drift: -2, audioReadyState: 1 })).toBe("wait");
  });

  it("still holds a stalled video's audio even while rate-limited", () => {
    expect(decide({ drift: 3, videoAdvancing: false, msSinceLastRealign: 0 })).toBe("hold");
  });

  it("treats a starved video as not-advancing even if its clock moved recently", () => {
    // Right after a quality switch the progress sampler still reports the old
    // clock as advancing; readyState is the immediate signal that it is not.
    expect(decide({ drift: 0.6, videoStarved: true })).toBe("hold");
    expect(decide({ drift: 5, videoStarved: true, msSinceLastRealign: 0 })).toBe("hold");
  });

  it("does not release a hold while the video is still starved", () => {
    expect(decide({ held: true, drift: 0.05, videoStarved: true })).toBe("wait");
    expect(decide({ held: true, drift: 0.05, videoStarved: false })).toBe("resume");
  });

  it("still realigns audio that fell behind a starved video", () => {
    // Moving audio forward onto a stalled clock cannot loop: only rewinding
    // audio that ran ahead can.
    expect(decide({ drift: -2, videoStarved: true })).toBe("realign");
  });
});
