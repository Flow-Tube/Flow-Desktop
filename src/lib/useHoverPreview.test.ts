import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  pickHoverPreviewLevel,
  getPreviewClusterCount,
  useHoverPreview,
  FRAMES_PER_CLUSTER,
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
    targetWidth?: number;
    targetHeight?: number;
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

  it("does not activate before the 500ms hover intent delay", () => {
    act(() => {
      root.render(
        createElement(TestComponent, {
          videoId: "vid1",
          isHovered: true,
          durationSeconds: 60,
        })
      );
    });

    // 400ms passed: still waiting for 500ms hover intent
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(lastHookResult?.isPreviewActive).toBe(false);
  });

  it("cancels pending hover if unhovered before 500ms", () => {
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
      vi.advanceTimersByTime(250);
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
      vi.advanceTimersByTime(500);
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
            targetWidth: 360,
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
    // <= 30s -> 1 continuous clip
    expect(getPreviewClusterCount(15)).toBe(1);
    expect(getPreviewClusterCount(30)).toBe(1);
    // 30s - 3m -> 2 clusters
    expect(getPreviewClusterCount(90)).toBe(2);
    expect(getPreviewClusterCount(180)).toBe(2);
    // 3m - 10m -> 3 clusters
    expect(getPreviewClusterCount(300)).toBe(3);
    expect(getPreviewClusterCount(600)).toBe(3);
    // 10m - 30m -> 4 clusters
    expect(getPreviewClusterCount(1200)).toBe(4);
    expect(getPreviewClusterCount(1800)).toBe(4);
    // 30m+ / 1hr+ -> 5 clusters
    expect(getPreviewClusterCount(3600)).toBe(5);
  });

  it("plays clusters non-repetitively and reaches 100% progress before holding", async () => {
    const mockLevels: StoryboardLevel[] = [
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
            videoId: "vid_short",
            isHovered: true,
            durationSeconds: 20, // 1 cluster = 5 frames
          })
        );
      });

      await act(async () => {
        vi.advanceTimersByTime(550);
      });

      expect(lastHookResult?.isPreviewActive).toBe(true);
      expect(lastHookResult?.progressPercent).toBe(Math.round((1 / FRAMES_PER_CLUSTER) * 100));

      // Advance through remaining 4 frames
      for (let i = 0; i < FRAMES_PER_CLUSTER - 1; i++) {
        act(() => {
          vi.advanceTimersByTime(FRAME_CYCLE_INTERVAL_MS);
        });
      }

      // Reached final frame: 100% progress
      expect(lastHookResult?.progressPercent).toBe(100);

      // Advance further: should NOT loop back (non-repetitive)
      act(() => {
        vi.advanceTimersByTime(FRAME_CYCLE_INTERVAL_MS * 2);
      });

      expect(lastHookResult?.progressPercent).toBe(100);
      expect(lastHookResult?.isPreviewActive).toBe(true);
    } finally {
      globalThis.Image = originalImage;
    }
  });
});
