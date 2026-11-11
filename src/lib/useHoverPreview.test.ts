import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  pickHoverPreviewLevel,
  getPreviewClusterCount,
  useHoverPreview,
  TOTAL_PREVIEW_FRAMES,
  FRAME_CYCLE_INTERVAL_MS,
} from "./useHoverPreview";
import { useHoverPreviewStore } from "../store/useHoverPreviewStore";
import * as youtubeApi from "./api/youtube";
import type { StoryboardLevel } from "../types/video";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useHoverPreview", () => {
  let host: HTMLDivElement;
  let root: Root;
  let lastHookResult: ReturnType<typeof useHoverPreview> | null = null;

  function TestComponent(props: {
    videoId: string;
    isHovered: boolean;
    durationSeconds?: number;
    measure?: () => { width: number; height: number } | null;
    enabled?: boolean;
  }) {
    const result = useHoverPreview(props);
    lastHookResult = result;
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    useHoverPreviewStore.setState({ activeVideoId: null });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    lastHookResult = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.useRealTimers();
  });

  it("asks for nothing while disabled", async () => {
    const storyboard = vi.spyOn(youtubeApi, "getVideoStoryboard").mockResolvedValue([]);
    act(() => {
      root.render(createElement(TestComponent, { videoId: "vid_off", isHovered: true, durationSeconds: 60, enabled: false }));
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(storyboard).not.toHaveBeenCalled();
    expect(lastHookResult?.isPreviewActive).toBe(false);
    storyboard.mockRestore();
  });

  it("remains inactive when isHovered is false", () => {
    act(() => {
      root.render(
        createElement(TestComponent, {
          videoId: "vid1",
          isHovered: false,
          durationSeconds: 60,
        })
      );
    });

    expect(lastHookResult?.isPreviewActive).toBe(false);
    expect(lastHookResult?.currentFrame).toBeNull();
  });

  it("does not activate before the 400ms hover intent delay", () => {
    act(() => {
      root.render(
        createElement(TestComponent, {
          videoId: "vid1",
          isHovered: true,
          durationSeconds: 60,
        })
      );
    });

    // 300ms passed: still waiting for 400ms hover intent
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(lastHookResult?.isPreviewActive).toBe(false);
  });

  it("cancels pending hover if unhovered before 400ms", () => {
    const spy = vi.spyOn(youtubeApi, "getVideoStoryboard");

    act(() => {
      root.render(
        createElement(TestComponent, {
          videoId: "vid1",
          isHovered: true,
          durationSeconds: 60,
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    act(() => {
      root.render(
        createElement(TestComponent, {
          videoId: "vid1",
          isHovered: false,
          durationSeconds: 60,
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(spy).not.toHaveBeenCalled();
    expect(lastHookResult?.isPreviewActive).toBe(false);
    expect(useHoverPreviewStore.getState().activeVideoId).toBeNull();
  });

  it("cleans up active video ID on unmount", () => {
    act(() => {
      root.render(
        createElement(TestComponent, {
          videoId: "vid1",
          isHovered: true,
          durationSeconds: 60,
        })
      );
      useHoverPreviewStore.setState({ activeVideoId: "vid1" });
    });

    act(() => {
      root.unmount();
    });

    expect(useHoverPreviewStore.getState().activeVideoId).toBeNull();
  });

  it("picks the high-resolution storyboard level matching card width", async () => {
    const mockLevels: StoryboardLevel[] = [
      {
        width: 160,
        height: 90,
        count: 25,
        columns: 5,
        rows: 5,
        intervalMs: 2000,
        urlTemplate: "https://example.com/test_160_$M.jpg",
      },
      {
        width: 320,
        height: 180,
        count: 25,
        columns: 3,
        rows: 3,
        intervalMs: 2000,
        urlTemplate: "https://example.com/test_320_$M.jpg",
      },
    ];

    vi.spyOn(youtubeApi, "getVideoStoryboard").mockResolvedValue(mockLevels);

    const originalImage = globalThis.Image;
    // @ts-expect-error mock image
    globalThis.Image = class {
      complete = true;
      naturalWidth = 960;
      set src(_val: string) {}
    };

    try {
      act(() => {
        root.render(
          createElement(TestComponent, {
            videoId: "vid_hires",
            isHovered: true,
            durationSeconds: 50,
            measure: () => ({ width: 360, height: 0 }),
          })
        );
      });

      await act(async () => {
        vi.advanceTimersByTime(550);
      });

      expect(lastHookResult?.isPreviewActive).toBe(true);
      expect(lastHookResult?.currentLevel?.width).toBe(320);
    } finally {
      globalThis.Image = originalImage;
    }
  });

  it("selects storyboard level matching card pixel height and width", () => {
    const levels: StoryboardLevel[] = [
      {
        width: 160,
        height: 90,
        count: 25,
        columns: 5,
        rows: 5,
        intervalMs: 2000,
        urlTemplate: "test",
      },
      {
        width: 320,
        height: 180,
        count: 25,
        columns: 3,
        rows: 3,
        intervalMs: 2000,
        urlTemplate: "test",
      },
    ];

    // Card height 180px matches 320x180
    expect(pickHoverPreviewLevel(levels, 180, 320)?.height).toBe(180);
    // Compact card height 90px matches 160x90
    expect(pickHoverPreviewLevel(levels, 90, 160)?.height).toBe(90);
    // Empty levels returns null
    expect(pickHoverPreviewLevel([])).toBeNull();
  });

  it("adapts preview cluster count according to video duration", () => {
    // <= 30s -> 1 continuous section (24 frames)
    expect(getPreviewClusterCount(15)).toBe(1);
    expect(getPreviewClusterCount(30)).toBe(1);
    // 30s - 3m -> 2 sections (12 frames each)
    expect(getPreviewClusterCount(90)).toBe(2);
    expect(getPreviewClusterCount(180)).toBe(2);
    // > 3m -> 3 sections (Opening: 8, Middle: 8, Later: 8 frames)
    expect(getPreviewClusterCount(300)).toBe(3);
    expect(getPreviewClusterCount(600)).toBe(3);
    expect(getPreviewClusterCount(3600)).toBe(3);
  });

  it("distributes 24 frames @ 8 FPS across 3 sections in a continuous loop", async () => {
    const mockLevels: StoryboardLevel[] = [
      {
        width: 320,
        height: 180,
        count: 50,
        columns: 3,
        rows: 3,
        intervalMs: 2000,
        urlTemplate: "https://example.com/test_320_$M.jpg",
      },
    ];

    vi.spyOn(youtubeApi, "getVideoStoryboard").mockResolvedValue(mockLevels);

    const originalImage = globalThis.Image;
    // @ts-expect-error mock image
    globalThis.Image = class {
      complete = true;
      naturalWidth = 960;
      set src(_val: string) {}
    };

    try {
      act(() => {
        root.render(
          createElement(TestComponent, {
            videoId: "vid_continuous",
            isHovered: true,
            durationSeconds: 120, // 2-minute video -> 2 clusters * 12 = 24 frames
          })
        );
      });

      await act(async () => {
        vi.advanceTimersByTime(450); // 400ms hover delay + buffer
      });

      expect(lastHookResult?.isPreviewActive).toBe(true);
      expect(lastHookResult?.progressPercent).toBe(Math.round((1 / TOTAL_PREVIEW_FRAMES) * 100));

      // Advance through remaining 23 frames to reach 100%
      for (let i = 0; i < TOTAL_PREVIEW_FRAMES - 1; i++) {
        act(() => {
          vi.advanceTimersByTime(FRAME_CYCLE_INTERVAL_MS);
        });
      }

      // Reached final frame: 100% progress
      expect(lastHookResult?.progressPercent).toBe(100);

      // Advance one more interval: seamlessly loops back to frame 0
      act(() => {
        vi.advanceTimersByTime(FRAME_CYCLE_INTERVAL_MS);
      });

      expect(lastHookResult?.progressPercent).toBe(Math.round((1 / TOTAL_PREVIEW_FRAMES) * 100));
      expect(lastHookResult?.isPreviewActive).toBe(true);
    } finally {
      globalThis.Image = originalImage;
    }
  });
});
