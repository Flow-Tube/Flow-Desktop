import { describe, expect, it } from "vitest";
import {
  MAX_AUTO_RERESOLVES,
  RERESOLVE_SPACING_SECONDS,
  recordAutoReResolve,
  shouldAutoReResolve,
  type ReResolveHistory,
} from "./videoRecoveryPolicy";

const attempt = { videoId: "v", position: 1200, isLive: false, sourcePlayed: true, hasNextSource: true };

describe("shouldAutoReResolve", () => {
  it("re-resolves the first time a playing video stops", () => {
    expect(shouldAutoReResolve(null, attempt)).toBe(true);
  });

  it("never re-resolves a live stream", () => {
    expect(shouldAutoReResolve(null, { ...attempt, isLive: true })).toBe(false);
  });

  it("tries the next source mode for a video that never started", () => {
    expect(shouldAutoReResolve(null, { ...attempt, sourcePlayed: false })).toBe(false);
    expect(shouldAutoReResolve(null, { ...attempt, sourcePlayed: false, hasNextSource: false })).toBe(true);
  });

  it("waits until the last recovery has played five minutes", () => {
    const history = recordAutoReResolve(null, "v", 1200);
    expect(shouldAutoReResolve(history, { ...attempt, position: 1260 })).toBe(false);
    expect(shouldAutoReResolve(history, { ...attempt, position: 1200 + RERESOLVE_SPACING_SECONDS })).toBe(true);
  });

  it("stops after three recoveries of one video", () => {
    let history: ReResolveHistory | null = null;
    let position = 600;
    for (let i = 0; i < MAX_AUTO_RERESOLVES; i += 1) {
      expect(shouldAutoReResolve(history, { ...attempt, position })).toBe(true);
      history = recordAutoReResolve(history, "v", position);
      position += RERESOLVE_SPACING_SECONDS;
    }
    expect(shouldAutoReResolve(history, { ...attempt, position: position + 3600 })).toBe(false);
  });

  it("starts the count again for another video", () => {
    let history: ReResolveHistory | null = null;
    for (let i = 0; i < MAX_AUTO_RERESOLVES; i += 1) history = recordAutoReResolve(history, "v", 600 + i * 400);
    expect(history?.count).toBe(MAX_AUTO_RERESOLVES);
    expect(shouldAutoReResolve(history, { ...attempt, videoId: "w", position: 10 })).toBe(true);
    expect(recordAutoReResolve(history, "w", 10)).toEqual({ videoId: "w", count: 1, position: 10 });
  });
});
